import { getPrimaryAnalyzer, type MorphToken } from "./analyzer.js";
import { disambiguateReading } from "./readings.js";
import type { ReadingDecision } from "./types.js";

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
  const morae = t.morae ?? (reading ? null : null);

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
  const tokens = await getPrimaryAnalyzer().analyze(text);
  return tokens.map((t) => toAnalyzed(t, opts));
}

/** Whole-token furigana segments for ruby rendering on the client. */
export interface FuriganaSegment {
  text: string;
  reading?: string;
  /** True when the reading is uncertain — render plainly / warn rather than trust. */
  uncertain?: boolean;
}

export async function toFuriganaSegments(text: string, opts: AnalyzeOptions = {}): Promise<FuriganaSegment[]> {
  const tokens = await tokenize(text, opts);
  return tokens.map((t) => {
    if (t.furigana) return { text: t.surface, reading: t.furigana };
    if (t.readingDecision.needsReview && t.readingDecision.selected) {
      return { text: t.surface, uncertain: true };
    }
    return { text: t.surface };
  });
}
