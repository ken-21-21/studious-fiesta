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
 * Breaks after Japanese terminators (。！？\n) and after English terminators
 * (.!?) followed by whitespace, so a paragraph that mixes an English
 * explanation with Japanese examples is separated correctly.
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  // Break after Japanese punctuation (。 \u3002, 、 \u3001, ！ \uFF01, ？ \uFF1F) or any newline \n, 
  // and after English terminators (.!?) followed by whitespace.
  const pieces = normalized
    .split(/(?<=[\u3002\u3001\uFF01\uFF1F\n])|(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const piece of pieces) {
    // Collapse weird spacing from raw epub/srt imports (including full-width spaces \u3000)
    const cleaned = piece.replace(/[\s\u3000]+/g, " ").trim();
    if (cleaned.length >= 1) out.push(cleaned);
  }
  return out;
}
