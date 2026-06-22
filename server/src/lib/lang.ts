import { hasJapanese, japaneseRatio } from "./jp/kana.js";

export type Lang = "ja" | "en" | "mixed";

/** Classify a span of text as Japanese, English, or mixed. */
export function classify(text: string): Lang {
  const ratio = japaneseRatio(text);
  if (ratio >= 0.6) return "ja";
  if (ratio <= 0.1) return "en";
  return hasJapanese(text) ? "mixed" : "en";
}

/** Does this block contain enough Japanese to warrant the JP pipeline? */
export function isJapaneseDoc(text: string): boolean {
  return japaneseRatio(text) >= 0.15;
}

/**
 * Split mixed Japanese/English text into sentences.
 *
 * Breaks after Japanese terminators (。！？) and after English terminators
 * (.!?) followed by whitespace, so a paragraph that mixes an English
 * explanation with Japanese examples is separated correctly.
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const pieces = normalized
    .split(/(?<=[。！？])|(?<=[.!?])\s+|\n{2,}/u)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const piece of pieces) {
    // Collapse internal single newlines/whitespace runs within a sentence.
    const cleaned = piece.replace(/\s*\n\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim();
    if (cleaned.length >= 2) out.push(cleaned);
  }
  return out;
}
