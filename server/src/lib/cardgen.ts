import { tokenize, type AnalyzedToken, type FuriganaSegment } from "./jp/tokenizer.js";
import { lookupPitch, type PitchInfo } from "./jp/pitch.js";
import { countMorae } from "./jp/morae.js";
import { hasJapanese, hasKanji, kataToHira } from "./jp/kana.js";
import { classify, splitSentences } from "./lang.js";
import { makeEnglishCloze } from "./en.js";
import { scrambledOrder } from "./shuffle.js";
import type { Lesson, Section, SectionType } from "./segment.js";

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
}

async function analyzeTerm(term: string, explicitReading?: string): Promise<TermAnalysis> {
  // A source-provided reading (e.g. an Anki/vocab-list reading column) is
  // trustworthy: treat it as whole-word ruby and skip disambiguation doubt.
  if (explicitReading) {
    const reading = kataToHira(explicitReading);
    const tokens = await tokenize(term);
    const content = tokens.filter((t) => t.isContentWord);
    const target = content.sort((a, b) => b.surface.length - a.surface.length)[0] ?? tokens[0];
    const pitch = target ? await lookupPitch(target.base, target.reading) : null;
    return {
      furigana: [{ text: term, reading }],
      reading,
      morae: countMorae(reading),
      pitch,
      readingUncertain: false,
      alternatives: [],
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
      pitch = await lookupPitch(target.base, target.reading);
    }
  }

  return { furigana: furiganaOf(tokens), reading, morae, pitch, readingUncertain, alternatives };
}

async function vocabNote(entry: VocabEntry): Promise<NoteSpec> {
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
  };
}

// ---------------------------------------------------------------------------
// Sentence-based cards (grammar / dialogue / culture / reading / content)
// ---------------------------------------------------------------------------

function pickJpClozeIndex(tokens: AnalyzedToken[]): number | null {
  const content = tokens
    .map((t, i) => ({ t, i }))
    .filter((x) => x.t.isContentWord && hasJapanese(x.t.surface));
  if (content.length) return content[Math.floor(content.length / 2)].i;
  const particles = tokens.map((t, i) => ({ t, i })).filter((x) => x.t.pos === "助詞");
  if (particles.length) return particles[Math.floor(particles.length / 2)].i;
  return null;
}

async function japaneseSentenceCards(sentence: string, type: SectionType): Promise<CardSpec[]> {
  const tokens = await tokenize(sentence);
  const wordTokens = tokens.filter((t) => t.pos !== PUNCT_POS);
  const furigana = furiganaOf(tokens);
  const cards: CardSpec[] = [];

  const wantCloze = type === "grammar" || type === "culture" || type === "reading" || type === "content";
  const wantScramble = type === "grammar" || type === "dialogue" || type === "content" || type === "practice";
  const wantListening = type === "dialogue" || type === "reading" || type === "content" || type === "grammar";

  if (wantCloze) {
    const idx = pickJpClozeIndex(tokens);
    if (idx !== null) {
      const clozeFuri = tokens.map((t, i) => (i === idx ? { text: BLANK } : furigana[i]));
      const clozeText = tokens.map((t, i) => (i === idx ? BLANK : t.surface)).join("");
      cards.push({
        cardType: "cloze",
        question: { text: clozeText, furigana: clozeFuri, lang: "ja" },
        answer: { text: tokens[idx].surface, reading: tokens[idx].reading ?? undefined },
      });
    }
  }

  if (wantScramble && wordTokens.length >= 3 && wordTokens.length <= 14) {
    const words = wordTokens.map((t) => t.surface);
    cards.push({
      cardType: "scramble",
      question: { words: scrambledOrder(words), lang: "ja" },
      answer: { words, reading: readingOf(wordTokens) },
    });
  }

  if (wantListening) {
    cards.push({
      cardType: "listening",
      question: { tts: sentence, lang: "ja", prompt: "Type what you hear" },
      answer: { text: sentence, furigana, lang: "ja" },
    });
  }

  return cards;
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

async function sentenceNote(sentence: string, type: SectionType): Promise<NoteSpec | null> {
  const lang = classify(sentence);
  const cards =
    lang === "en"
      ? englishSentenceCards(sentence, type)
      : await japaneseSentenceCards(sentence, type);
  if (!cards.length) return null;
  return { fields: { sentence }, tags: type, cards };
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
