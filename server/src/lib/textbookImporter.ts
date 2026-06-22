import fs from "node:fs";
import path from "node:path";
import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";
import { db } from "../db/index.js";
import { newCardDefaults } from "./fsrs.js";

const nlp = winkNLP(model);
const its = nlp.its as any;

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "to", "of",
  "and", "in", "on", "at", "for", "with", "as", "it", "this", "that",
  "i", "you", "he", "she", "we", "they", "do", "does", "did",
]);

function splitSentences(text: string): string[] {
  const doc = nlp.readDoc(text);
  return doc
    .sentences()
    .out()
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 8 && s.length < 220);
}

function pickClozeWord(sentence: string): { word: string; index: number } | null {
  const doc = nlp.readDoc(sentence);
  const tokens = doc.tokens().out(its.value) as string[];
  const pos = doc.tokens().out(its.pos) as string[];
  const candidates: { word: string; index: number }[] = [];
  tokens.forEach((tok, i) => {
    const tag = pos[i];
    const lower = tok.toLowerCase();
    if (
      (tag === "NOUN" || tag === "VERB" || tag === "ADJ") &&
      tok.length > 2 &&
      !STOPWORDS.has(lower)
    ) {
      candidates.push({ word: tok, index: i });
    }
  });
  if (!candidates.length) return null;
  return candidates[Math.floor(candidates.length / 2)];
}

function makeCloze(sentence: string): { text: string; answer: string } | null {
  const pick = pickClozeWord(sentence);
  if (!pick) return null;
  const re = new RegExp(`\\b${pick.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  const text = sentence.replace(re, "_____");
  if (text === sentence) return null;
  return { text, answer: pick.word };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Plain shuffle on a short array sometimes returns the original order; retry
// a few times so scramble cards are actually scrambled when possible.
function scrambledOrder<T>(arr: T[]): T[] {
  if (arr.length < 2) return arr;
  let attempt = shuffle(arr);
  for (let i = 0; i < 5 && attempt.join(" ") === arr.join(" "); i++) {
    attempt = shuffle(arr);
  }
  return attempt;
}

export async function importTextbook(filePath: string, originalFilename: string, deckName: string) {
  const ext = path.extname(originalFilename).toLowerCase();
  let text: string;
  if (ext === ".pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const buf = fs.readFileSync(filePath);
    const result = await pdfParse(buf);
    text = result.text;
  } else {
    text = fs.readFileSync(filePath, "utf-8");
  }

  const sentences = splitSentences(text);
  if (!sentences.length) throw new Error("No usable sentences found in the document");

  // Cap to avoid runaway generation on huge textbooks in one import.
  const MAX_SENTENCES = 400;
  const toProcess = sentences.slice(0, MAX_SENTENCES);

  const insertDeck = db.prepare("INSERT INTO decks (name) VALUES (?)");
  const insertNote = db.prepare(
    "INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'textbook', ?, '')"
  );
  const insertCard = db.prepare(`
    INSERT INTO cards (note_id, deck_id, card_type, question, answer, media,
      due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state)
    VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const importAll = db.transaction((sentences: string[]) => {
    const deckRow = insertDeck.run(deckName);
    const deckId = Number(deckRow.lastInsertRowid);

    let cardsCreated = 0;
    for (const sentence of sentences) {
      const noteRes = insertNote.run(deckId, JSON.stringify({ sentence }));
      const noteId = Number(noteRes.lastInsertRowid);

      const cloze = makeCloze(sentence);
      const words = sentence.replace(/[.?!]$/, "").split(/\s+/).filter(Boolean);

      const cardSpecs: { type: string; question: object; answer: object }[] = [];

      if (cloze) {
        cardSpecs.push({
          type: "cloze",
          question: { text: cloze.text },
          answer: { text: cloze.answer },
        });
      }

      if (words.length >= 4 && words.length <= 14) {
        cardSpecs.push({
          type: "scramble",
          question: { words: scrambledOrder(words) },
          answer: { words },
        });
      }

      // Listening card: browser TTS reads the sentence (no audio file required),
      // learner types what they heard.
      cardSpecs.push({
        type: "listening",
        question: { tts: sentence },
        answer: { text: sentence },
      });

      for (const spec of cardSpecs) {
        const defaults = newCardDefaults();
        insertCard.run(
          noteId,
          deckId,
          spec.type,
          JSON.stringify(spec.question),
          JSON.stringify(spec.answer),
          defaults.due,
          defaults.stability,
          defaults.difficulty,
          defaults.elapsed_days,
          defaults.scheduled_days,
          defaults.reps,
          defaults.lapses,
          defaults.state
        );
        cardsCreated++;
      }
    }

    return { deckId, cardsCreated };
  });

  const { deckId, cardsCreated } = importAll(toProcess);
  return { deckId, cardsCreated, sentencesProcessed: toProcess.length };
}
