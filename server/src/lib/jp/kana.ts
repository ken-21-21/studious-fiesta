// Script detection and kana conversion helpers shared across the JP pipeline.

const HIRAGANA = /[぀-ゟ]/;
const KATAKANA = /[゠-ヿ]/;
const KANJI = /[一-鿿㐀-䶿]/;
// Japanese punctuation / full-width marks that should count as "Japanese context".
const JP_PUNCT = /[　-〿＀-￯]/;
const LATIN_LETTER = /[A-Za-z]/;

export function hasHiragana(s: string): boolean {
  return HIRAGANA.test(s);
}
export function hasKatakana(s: string): boolean {
  return KATAKANA.test(s);
}
export function hasKanji(s: string): boolean {
  return KANJI.test(s);
}
export function hasKana(s: string): boolean {
  return HIRAGANA.test(s) || KATAKANA.test(s);
}
export function hasJapanese(s: string): boolean {
  return hasKana(s) || hasKanji(s);
}
export function isKanjiChar(ch: string): boolean {
  return KANJI.test(ch);
}

/** Fraction of "meaningful" characters that are Japanese (kana/kanji/JP punct). */
export function japaneseRatio(s: string): number {
  let jp = 0;
  let total = 0;
  for (const ch of s) {
    if (/\s/.test(ch)) continue;
    if (HIRAGANA.test(ch) || KATAKANA.test(ch) || KANJI.test(ch) || JP_PUNCT.test(ch)) {
      jp++;
      total++;
    } else if (LATIN_LETTER.test(ch) || /[0-9]/.test(ch) || /[.,;:!?'"()\-]/.test(ch)) {
      total++;
    } else {
      total++;
    }
  }
  return total === 0 ? 0 : jp / total;
}

const KATA_TO_HIRA_OFFSET = 0x3041 - 0x30a1;

/** Convert katakana to hiragana (leaves other characters untouched). */
export function kataToHira(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    // Katakana block 0x30A1–0x30F6 maps onto hiragana; keep ー (long mark) as-is.
    if (code >= 0x30a1 && code <= 0x30f6) {
      out += String.fromCodePoint(code + KATA_TO_HIRA_OFFSET);
    } else {
      out += ch;
    }
  }
  return out;
}

/** Convert hiragana to katakana (leaves other characters untouched). */
export function hiraToKata(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x3041 && code <= 0x3096) {
      out += String.fromCodePoint(code - KATA_TO_HIRA_OFFSET);
    } else {
      out += ch;
    }
  }
  return out;
}
