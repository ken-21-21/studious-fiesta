import { hiraToKata } from "./kana.js";

// Small kana that fuse with the preceding kana into a single mora (yōon / small vowels).
const FUSED = new Set([
  "ャ", "ュ", "ョ", "ァ", "ィ", "ゥ", "ェ", "ォ", "ヮ", "ヵ", "ヶ",
]);

// Anything in the katakana block (plus the chōonpu ー) counts as a kana beat.
const KANA = /[ァ-ヶー]/;

/**
 * Count morae (phonological beats) from a reading.
 *
 * Rules:
 *  - small ゃゅょ etc. fuse into the previous mora (not counted separately)
 *  - long-vowel mark ー, sokuon ッ, and moraic ン each count as their own mora
 *
 * Accepts hiragana or katakana; normalises to katakana first.
 */
export function countMorae(reading: string): number {
  const kata = hiraToKata(reading);
  let n = 0;
  for (const ch of kata) {
    if (FUSED.has(ch)) continue;
    if (KANA.test(ch)) n++;
  }
  return n;
}

/**
 * Split a reading into mora units (each entry is one beat, fused kana grouped).
 * Useful for aligning pitch-accent patterns to individual morae.
 */
export function splitMorae(reading: string): string[] {
  const kata = hiraToKata(reading);
  const morae: string[] = [];
  for (const ch of kata) {
    if (FUSED.has(ch) && morae.length > 0) {
      morae[morae.length - 1] += ch;
    } else if (KANA.test(ch)) {
      morae.push(ch);
    }
  }
  return morae;
}
