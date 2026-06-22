import fs from "node:fs";
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

export async function importTextbook(filePath: string, mimeType: string, deckName: string) {
  let text: string;
  if (mimeType === "application/pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const buf = fs.readFileSync(filePath);
    const result = await pdfParse(buf);
    text = result.text;
  } else {
    text = fs.readFileSync(filePath, "utf-8");
  }

  const sentences = splitSentences(text);
  if (!sentences.length) throw new Error("No usable sentences found in the document");

  const deckRow = db.prepare("INSERT INTO decks (name) VALUES (?)").run(deckName);
  const deckId = Number(deckRow.lastInsertRowid);

  const insertNote = db.prepare(
    "INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'textbook', ?, '')"
  );
  const insertCard = db.prepare(`
    INSERT INTO cards (note_id, deck_id, card_type, question, answer, media,
      due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state)
    VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let cardsCreated = 0;
  // Cap to avoid runaway generation on huge textbooks in one import.
  const MAX_SENTENCES = 400;
  for (const sentence of sentences.slice(0, MAX_SENTENCES)) {
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
        question: { words: shuffle(words) },
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

  return { deckId, cardsCreated, sentencesProcessed: Math.min(sentences.length, MAX_SENTENCES) };
}
