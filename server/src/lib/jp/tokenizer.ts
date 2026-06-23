import { getPrimaryAnalyzer, type MorphToken } from "./analyzer.js";
import { disambiguateReading } from "./readings.js";
import type { ReadingDecision } from "./types.js";
import { normalizeText } from "./normalize.js";
import { hasKanji, hasKana } from "./kana.js";

// Parts of speech that make good vocabulary / cloze targets.
const CONTENT_POS = new Set(["名詞", "動詞", "形容詞", "副詞", "形状詞", "連体詞"]);

export interface AnalyzedToken {
  surface: string;
  pos: string;
  posDetail: string;
  base: string;
  /** Chosen reading (hiragana) or null when we decline to commit. */
  reading: string | null;
  pronunciation: string | null;
  conjugationType: string | null;
  conjugationForm: string | null;
  /** Furigana for ruby display — only set when the reading is confident. */
  furigana: string | null;
  morae: number | null;
  isContentWord: boolean;
  /** Full inspectable reading decision: candidates, confidence, evidence. */
  readingDecision: ReadingDecision;
}

export interface AnalyzeOptions {
  /** Optional scope key so scoped user corrections can match. */
  context?: string;
  /** Reading explicitly supplied by the source, keyed by surface form. */
  sourceFurigana?: Record<string, string>;
}

function toAnalyzed(t: MorphToken, opts: AnalyzeOptions): AnalyzedToken {
  const analyzer = getPrimaryAnalyzer();
  const decision = disambiguateReading({
    surface: t.surface,
    hasKanji: t.hasKanji,
    analyzerReading: t.reading,
    analyzerName: analyzer.name,
    analyzerVersion: analyzer.version,
    sourceFurigana: opts.sourceFurigana?.[t.surface] ?? null,
    context: opts.context,
  });

  const reading = decision.selected;
  const furigana = t.hasKanji && reading && !decision.needsReview ? reading : null;

  return {
    surface: t.surface,
    pos: t.pos,
    posDetail: t.posDetail,
    base: t.base,
    reading,
    pronunciation: t.pronunciation,
    conjugationType: t.conjugationType,
    conjugationForm: t.conjugationForm,
    furigana,
    morae: t.morae,
    isContentWord: CONTENT_POS.has(t.pos) && t.posDetail !== "非自立",
    readingDecision: decision,
  };
}

export async function tokenize(text: string, opts: AnalyzeOptions = {}): Promise<AnalyzedToken[]> {
  const normalizedText = normalizeText(text);
  const tokens = await getPrimaryAnalyzer().analyze(normalizedText);
  return tokens.map((t) => toAnalyzed(t, opts));
}

/** Whole-token furigana segments for ruby rendering on the client. */
export interface FuriganaSegment {
  text: string;
  reading?: string;
  /** True when the reading is uncertain — render plainly / warn rather than trust. */
  uncertain?: boolean;
}

/**
 * Split a token into kanji-run(s) and kana-run(s) before building
 * FuriganaSegments, so the ruby annotation only covers the kanji and not the
 * already-readable kana okurigana.
 *
 * Algorithm (standard okurigana-alignment via exact string matching):
 * 1. Trim the longest matching kana suffix shared between surface and reading.
 * 2. Trim the longest matching kana prefix from what remains.
 * 3. The middle is the kanji run; its corresponding reading slice is its ruby text.
 *
 * Falls back to whole-token ruby when the surface has no kanji or when the
 * structural alignment can't be determined safely.
 *
 * Examples:
 *   食べる / たべる → [{ text:'食', reading:'た' }, { text:'べる' }]
 *   お茶   / おちゃ → [{ text:'お' }, { text:'茶', reading:'ちゃ' }]
 *   天気   / てんき → [{ text:'天気', reading:'てんき' }]  (all kanji, no split)
 */
export function splitOkurigana(surface: string, reading: string): FuriganaSegment[] {
  if (!hasKanji(surface)) {
    // Pure kana / punctuation — no ruby annotation needed.
    return [{ text: surface }];
  }

  const sChars = [...surface];
  const rChars = [...reading];

  // Step 1: find longest matching kana suffix (trailing okurigana).
  let suffixLen = 0;
  while (suffixLen < sChars.length && suffixLen < rChars.length) {
    const sCh = sChars[sChars.length - 1 - suffixLen];
    const rCh = rChars[rChars.length - 1 - suffixLen];
    if (!hasKana(sCh) || sCh !== rCh) break;
    suffixLen++;
  }

  // Step 2: find longest matching kana prefix from what remains.
  const sStem = sChars.slice(0, sChars.length - suffixLen);
  const rStem = rChars.slice(0, rChars.length - suffixLen);

  let prefixLen = 0;
  while (prefixLen < sStem.length && prefixLen < rStem.length) {
    const sCh = sStem[prefixLen];
    const rCh = rStem[prefixLen];
    if (!hasKana(sCh) || sCh !== rCh) break;
    prefixLen++;
  }

  const kanjiRun = sStem.slice(prefixLen).join("");
  const kanjiReading = rStem.slice(prefixLen).join("");

  // Safety: if the kanji run is empty or has no kanji, fall back to whole-token.
  if (!kanjiRun || !hasKanji(kanjiRun)) {
    return [{ text: surface, reading }];
  }

  const segs: FuriganaSegment[] = [];
  if (prefixLen > 0) segs.push({ text: sStem.slice(0, prefixLen).join("") });
  segs.push({ text: kanjiRun, reading: kanjiReading });
  if (suffixLen > 0) segs.push({ text: sChars.slice(sChars.length - suffixLen).join("") });
  return segs;
}

export async function toFuriganaSegments(text: string, opts: AnalyzeOptions = {}): Promise<FuriganaSegment[]> {
  const tokens = await tokenize(text, opts);
  return tokens.flatMap((t) => {
    if (t.furigana) return splitOkurigana(t.surface, t.furigana);
    if (t.readingDecision.needsReview && t.readingDecision.selected) {
      return [{ text: t.surface, uncertain: true }];
    }
    return [{ text: t.surface }];
  });
}
