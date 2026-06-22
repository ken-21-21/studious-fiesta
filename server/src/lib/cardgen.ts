import { tokenize, type AnalyzedToken, type FuriganaSegment } from "./jp/tokenizer.js";
import { analyzeGrammar } from "./jp/grammar.js";
import { readingRecords, grammarRecords, type AnalysisRecord } from "./jp/analysisRecord.js";
import { lookupPitch, type PitchInfo } from "./jp/pitch.js";
import { countMorae } from "./jp/morae.js";
import { hasJapanese, hasKanji, kataToHira } from "./jp/kana.js";
import { classify, splitSentences } from "./lang.js";
import { makeEnglishCloze } from "./en.js";
import { scrambledOrder } from "./shuffle.js";
import type { Lesson, Section, SectionType } from "./segment.js";
import { db } from "../db/index.js";
import { newCardDefaults } from "./fsrs.js";

export type CardType = "vocab" | "cloze" | "scramble" | "listening" | "pitch";

export interface CardSpec {
  cardType: CardType;
  question: Record<string, unknown>;
  answer: Record<string, unknown>;
  media?: Record<string, unknown>;
}

export interface NoteSpec {
  fields: Record<string, unknown>;
  tags: string;
  cards: CardSpec[];
  /** Persisted linguistic analysis behind this note's cards (provenance). */
  analysis?: AnalysisRecord[];
}

// Bounds so a single huge lesson can't generate an unbounded pile of cards.
const MAX_VOCAB_PER_LESSON = 400;
const MAX_SENTENCES_PER_LESSON = 600;
const BLANK = "＿＿＿";

const PUNCT_POS = "記号";

function furiganaOf(tokens: AnalyzedToken[]): FuriganaSegment[] {
  return tokens.map((t) => (t.furigana ? { text: t.surface, reading: t.furigana } : { text: t.surface }));
}

function readingOf(tokens: AnalyzedToken[]): string {
  return tokens.map((t) => t.reading ?? t.surface).join("");
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export interface VocabEntry {
  term: string;
  reading?: string;
  gloss: string;
}

/** Parse a vocabulary list line like "学生 がくせい student" or "たべる to eat". */
export function parseVocabLine(line: string): VocabEntry | null {
  // Strip list markers: "1.", "•", "-", etc.
  const s = line.replace(/^[\s•·・\-*]*\d*[.)]?\s*/u, "").trim();
  if (!hasJapanese(s)) return null;

  const termMatch = s.match(/^([\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}ーｰ・〜～]+)/u);
  if (!termMatch) return null;
  const term = termMatch[1];
  let rest = s.slice(term.length).trim();

  let reading: string | undefined;
  const paren = rest.match(/^[（(]\s*([\p{sc=Hiragana}\p{sc=Katakana}ー]+)\s*[)）]/u);
  if (paren) {
    reading = paren[1];
    rest = rest.slice(paren[0].length).trim();
  } else if (hasKanji(term)) {
    const kana = rest.match(/^([\p{sc=Hiragana}\p{sc=Katakana}ー]+)(?=\s|$)/u);
    if (kana) {
      reading = kana[1];
      rest = rest.slice(kana[1].length).trim();
    }
  }

  const gloss = rest.replace(/^[\s:：=ー\-–—]+/u, "").trim();
  if (!gloss || !/[A-Za-z]/.test(gloss)) return null; // need an English gloss
  return { term, reading, gloss };
}

interface TermAnalysis {
  furigana: FuriganaSegment[];
  reading: string;
  morae: number;
  pitch: PitchInfo | null;
  /** True when the term's reading is low-confidence and must not be trusted. */
  readingUncertain: boolean;
  /** Alternative readings to preserve for inspection/correction. */
  alternatives: string[];
  /** Persistable reading-decision records behind this term. */
  analysis: AnalysisRecord[];
}

async function analyzeTerm(term: string, explicitReading?: string): Promise<TermAnalysis> {
  // 1. A user correction on the whole term overrides everything, even explicit source readings.
  const correction = (await import("./corrections.js")).getReadingCorrection?.(term) ?? null;
  const userReading = correction ? correction.value : null;

  // A source-provided reading or user correction is trustworthy: treat it as
  // whole-word ruby and skip disambiguation doubt.
  const trustedReading = userReading ?? explicitReading;
  if (trustedReading) {
    const reading = kataToHira(trustedReading);
    const tokens = await tokenize(term, { sourceFurigana: { [term]: reading } });
    const content = tokens.filter((t) => t.isContentWord);
    const target = content.sort((a, b) => b.surface.length - a.surface.length)[0] ?? tokens[0];
    const pitch = (await lookupPitch(term, reading)) ?? (target ? await lookupPitch(target.base, target.reading) : null);
    
    const evidenceSource = userReading ? "user_correction" : "source_furigana";
    const evidenceDetail = userReading ? `User-corrected reading (scope: ${correction!.scope})` : "Reading supplied by source vocabulary list";

    return {
      furigana: [{ text: term, reading }],
      reading,
      morae: countMorae(reading),
      pitch,
      readingUncertain: false,
      alternatives: [],
      // A source-supplied or user-corrected reading is a single high-confidence whole-word claim.
      analysis: [
        {
          kind: "reading",
          surface: term,
          label: reading,
          spanStart: null,
          spanEnd: null,
          confidence: userReading ? 1 : 0.95,
          band: "high",
          needsReview: false,
          analyzerName: null,
          analyzerVersion: null,
          evidence: [{ source: evidenceSource, detail: evidenceDetail }],
          alternatives: [],
          payload: { surface: term, selected: reading, source: evidenceSource },
        },
      ],
    };
  }

  const tokens = await tokenize(term);
  const reading = readingOf(tokens);
  const morae = countMorae(reading);

  // The term's reading is only as trustworthy as its content tokens' readings.
  const content = tokens.filter((t) => t.isContentWord);
  const readingUncertain = content.some((t) => t.readingDecision.needsReview);
  const alternatives = Array.from(
    new Set(content.flatMap((t) => t.readingDecision.alternatives))
  );

  // Pitch is reading-dependent, so only compute it when the reading is trusted.
  let pitch: PitchInfo | null = null;
  if (!readingUncertain) {
    const target = content.sort((a, b) => b.surface.length - a.surface.length)[0] ?? tokens[0];
    if (target && !target.readingDecision.needsReview) {
      pitch = (await lookupPitch(term, reading)) ?? (await lookupPitch(target.base, target.reading));
    }
  }

  return {
    furigana: furiganaOf(tokens),
    reading,
    morae,
    pitch,
    readingUncertain,
    alternatives,
    analysis: readingRecords(tokens),
  };
}

export async function vocabNote(entry: VocabEntry): Promise<NoteSpec> {
  const a = await analyzeTerm(entry.term, entry.reading);
  const jp = {
    furigana: a.furigana,
    reading: a.readingUncertain ? undefined : a.reading,
    readingUncertain: a.readingUncertain || undefined,
    readingAlternatives: a.alternatives.length ? a.alternatives : undefined,
    morae: a.readingUncertain ? undefined : a.morae,
    pitch: a.pitch ?? undefined,
    lang: "ja" as const,
  };

  // Meaning recognition does not assert a reading, so it is always safe.
  const cards: CardSpec[] = [
    {
      cardType: "vocab",
      question: { text: entry.term, prompt: "What does this mean?", ...jp },
      answer: { text: entry.gloss },
    },
  ];

  // Reading-dependent cards are gated on a confident reading: a low-confidence
  // reading must never silently become trusted study material.
  if (!a.readingUncertain) {
    cards.push({
      cardType: "vocab",
      question: { text: entry.gloss, prompt: "Say this in Japanese", lang: "en" },
      answer: { text: entry.term, furigana: a.furigana, reading: a.reading },
    });
    cards.push({
      cardType: "listening",
      question: { tts: entry.term, lang: "ja", prompt: "What word did you hear?" },
      answer: { text: entry.term, furigana: a.furigana, reading: a.reading, gloss: entry.gloss },
    });
    if (a.pitch) {
      cards.push({
        cardType: "pitch",
        question: { text: entry.term, furigana: a.furigana, reading: a.reading, morae: a.morae, lang: "ja" },
        answer: { pitch: a.pitch },
      });
    }
  }

  return {
    fields: {
      Term: entry.term,
      Reading: a.readingUncertain ? "" : a.reading,
      Gloss: entry.gloss,
    },
    tags: a.readingUncertain ? "vocabulary needs_review" : "vocabulary",
    cards,
    analysis: a.analysis,
  };
}

// ---------------------------------------------------------------------------
// Sentence-based cards (grammar / dialogue / culture / reading / content)
// ---------------------------------------------------------------------------

function pickJpClozeIndex(tokens: AnalyzedToken[]): number | null {
  const content = tokens
    .map((t, i) => ({ t, i }))
    .filter((x) => x.t.isContentWord && hasJapanese(x.t.surface) && !x.t.readingDecision.needsReview);
  if (content.length) return content[Math.floor(content.length / 2)].i;
  const particles = tokens
    .map((t, i) => ({ t, i }))
    .filter((x) => x.t.pos === "助詞" && !x.t.readingDecision.needsReview);
  if (particles.length) return particles[Math.floor(particles.length / 2)].i;
  return null;
}

async function japaneseSentenceCards(
  sentence: string,
  type: SectionType
): Promise<{ cards: CardSpec[]; analysis: AnalysisRecord[] }> {
  const tokens = await tokenize(sentence);
  const wordTokens = tokens.filter((t) => t.pos !== PUNCT_POS);
  const furigana = furiganaOf(tokens);
  const cards: CardSpec[] = [];
  const analysis: AnalysisRecord[] = [
    ...readingRecords(tokens),
    ...grammarRecords(analyzeGrammar(tokens)),
  ];

  const wantCloze = type === "grammar" || type === "culture" || type === "reading" || type === "content";
  const wantScramble = type === "grammar" || type === "dialogue" || type === "content" || type === "practice";
  const wantListening = type === "dialogue" || type === "reading" || type === "content" || type === "grammar";

  if (wantCloze) {
    const idx = pickJpClozeIndex(tokens);
    if (idx !== null) {
      const target = tokens[idx];
      const clozeFuri = tokens.map((t, i) => (i === idx ? { text: BLANK } : furigana[i]));
      const clozeText = tokens.map((t, i) => (i === idx ? BLANK : t.surface)).join("");
      
      const isUncertain = target.readingDecision.needsReview;
      cards.push({
        cardType: "cloze",
        question: { text: clozeText, furigana: clozeFuri, lang: "ja" },
        answer: { 
          text: target.surface, 
          reading: isUncertain ? undefined : (target.reading ?? undefined),
          readingUncertain: isUncertain || undefined,
          readingAlternatives: isUncertain && target.readingDecision.alternatives.length ? target.readingDecision.alternatives : undefined
        },
      });
    }
  }

  if (wantScramble && wordTokens.length >= 3 && wordTokens.length <= 14) {
    const words = wordTokens.map((t) => t.surface);
    const readingUncertain = wordTokens.some((t) => t.readingDecision.needsReview);
    cards.push({
      cardType: "scramble",
      question: { words: scrambledOrder(words), lang: "ja" },
      answer: { 
        words, 
        reading: readingUncertain ? undefined : readingOf(wordTokens),
        readingUncertain: readingUncertain || undefined
      },
    });
  }

  if (wantListening) {
    cards.push({
      cardType: "listening",
      question: { tts: sentence, lang: "ja", prompt: "Type what you hear" },
      answer: { text: sentence, furigana, lang: "ja" },
    });
  }

  return { cards, analysis };
}

function englishSentenceCards(sentence: string, type: SectionType): CardSpec[] {
  const cards: CardSpec[] = [];
  const words = sentence.replace(/[.?!]+$/, "").split(/\s+/).filter(Boolean);

  const wantCloze = type !== "dialogue";
  const wantScramble = type === "grammar" || type === "dialogue" || type === "content" || type === "practice";

  if (wantCloze) {
    const cloze = makeEnglishCloze(sentence);
    if (cloze) {
      cards.push({
        cardType: "cloze",
        question: { text: cloze.text, lang: "en" },
        answer: { text: cloze.answer },
      });
    }
  }
  if (wantScramble && words.length >= 4 && words.length <= 14) {
    cards.push({
      cardType: "scramble",
      question: { words: scrambledOrder(words), lang: "en" },
      answer: { words },
    });
  }
  cards.push({
    cardType: "listening",
    question: { tts: sentence, lang: "en", prompt: "Type what you hear" },
    answer: { text: sentence, lang: "en" },
  });
  return cards;
}

export async function sentenceNote(sentence: string, type: SectionType): Promise<NoteSpec | null> {
  const lang = classify(sentence);
  if (lang === "en") {
    const cards = englishSentenceCards(sentence, type);
    if (!cards.length) return null;
    return { fields: { sentence }, tags: type, cards };
  }
  const { cards, analysis } = await japaneseSentenceCards(sentence, type);
  if (!cards.length) return null;
  return { fields: { sentence }, tags: type, cards, analysis };
}

// ---------------------------------------------------------------------------
// Section / lesson orchestration
// ---------------------------------------------------------------------------

async function generateSection(section: Section, budget: { vocab: number; sentences: number }): Promise<NoteSpec[]> {
  const notes: NoteSpec[] = [];

  if (section.type === "vocabulary") {
    for (const line of section.lines) {
      if (budget.vocab <= 0) break;
      const entry = parseVocabLine(line);
      if (!entry) continue;
      notes.push(await vocabNote(entry));
      budget.vocab--;
    }
    return notes;
  }

  const text = section.lines.join("\n");
  const sentences = splitSentences(text).filter((s) => s.length >= 4 && s.length <= 240);
  for (const sentence of sentences) {
    if (budget.sentences <= 0) break;
    const note = await sentenceNote(sentence, section.type);
    if (note) {
      notes.push(note);
      budget.sentences--;
    }
  }
  return notes;
}

export async function generateLessonNotes(lesson: Lesson): Promise<NoteSpec[]> {
  const budget = { vocab: MAX_VOCAB_PER_LESSON, sentences: MAX_SENTENCES_PER_LESSON };
  const notes: NoteSpec[] = [];
  for (const section of lesson.sections) {
    notes.push(...(await generateSection(section, budget)));
  }
  return notes;
}

export async function syncNoteCards(noteId: number) {
  const noteRow = db.prepare("SELECT * FROM notes WHERE id = ?").get(noteId) as any;
  if (!noteRow) return;

  const fields = JSON.parse(noteRow.fields);
  const tags = noteRow.tags;
  
  let spec: NoteSpec | null = null;
  if (tags.includes("vocabulary")) {
    const analysisRows = db.prepare("SELECT evidence FROM note_analyses WHERE note_id = ? AND kind = 'reading' AND surface = ?").all(noteId, fields.Term) as {evidence: string}[];
    let wasSourceFurigana = false;
    for (const r of analysisRows) {
      try {
        const evs = JSON.parse(r.evidence);
        if (evs.some((e: any) => e.source === "source_furigana")) {
          wasSourceFurigana = true;
        }
      } catch (e) {}
    }

    spec = await vocabNote({
      term: fields.Term,
      reading: wasSourceFurigana ? (fields.Reading || undefined) : undefined,
      gloss: fields.Gloss
    });
  } else {
    const type = tags.split(" ")[0] as SectionType;
    if (fields.sentence) {
      spec = await sentenceNote(fields.sentence, type);
    }
  }

  if (!spec) return;

  const existingCards = db.prepare("SELECT id, card_type FROM cards WHERE note_id = ?").all(noteId) as {id: number, card_type: string}[];
  const existingTypes = new Map(existingCards.map(c => [c.card_type, c.id]));

  const updateCardStmt = db.prepare(`UPDATE cards SET question = ?, answer = ?, media = ? WHERE id = ?`);
  const insertCardStmt = db.prepare(`
    INSERT INTO cards (note_id, deck_id, card_type, question, answer, media,
      due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM note_analyses WHERE note_id = ?").run(noteId);
    const insertAnalysis = db.prepare(`
      INSERT INTO note_analyses (note_id, kind, surface, label, span_start, span_end,
        confidence, band, needs_review, analyzer_name, analyzer_version, evidence, alternatives, payload, corrected_by_user)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const a of spec!.analysis ?? []) {
      const isCorrected = a.evidence.some(e => e.source === "user_correction") ? 1 : 0;
      insertAnalysis.run(
        noteId,
        a.kind,
        a.surface,
        a.label,
        a.spanStart,
        a.spanEnd,
        a.confidence,
        a.band,
        a.needsReview ? 1 : 0,
        a.analyzerName,
        a.analyzerVersion,
        JSON.stringify(a.evidence),
        JSON.stringify(a.alternatives),
        JSON.stringify(a.payload),
        isCorrected
      );
    }

    for (const card of spec!.cards) {
      const existingId = existingTypes.get(card.cardType);
      if (existingId) {
        updateCardStmt.run(
          JSON.stringify(card.question),
          JSON.stringify(card.answer),
          JSON.stringify(card.media ?? {}),
          existingId
        );
      } else {
        const defaults = newCardDefaults();
        insertCardStmt.run(
          noteId,
          noteRow.deck_id,
          card.cardType,
          JSON.stringify(card.question),
          JSON.stringify(card.answer),
          JSON.stringify(card.media ?? {}),
          defaults.due,
          defaults.stability,
          defaults.difficulty,
          defaults.elapsed_days,
          defaults.scheduled_days,
          defaults.reps,
          defaults.lapses,
          defaults.state
        );
      }
    }
  });

  tx();
}
