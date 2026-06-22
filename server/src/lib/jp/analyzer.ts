import path from "node:path";
import { createRequire } from "node:module";
import kuromoji, { type IpadicFeatures, type Tokenizer } from "kuromoji";
import { hasKanji, kataToHira } from "./kana.js";
import { countMorae } from "./morae.js";

const require = createRequire(import.meta.url);

/**
 * A single analyzer's view of one token. Deliberately analyzer-agnostic so a
 * second analyzer (e.g. a UniDic/MeCab or Sudachi adapter) can be plugged in
 * and compared without changing downstream code.
 */
export interface MorphToken {
  surface: string;
  pos: string;
  posDetail: string;
  /** Dictionary / lemma form. */
  base: string;
  /** Hiragana reading of the surface, if the analyzer supplies one. */
  reading: string | null;
  /** Hiragana pronunciation (natural speech: は→わ, を→お). */
  pronunciation: string | null;
  /** Conjugation type/form when available. */
  conjugationType: string | null;
  conjugationForm: string | null;
  hasKanji: boolean;
  morae: number | null;
}

export interface AnalyzerAdapter {
  readonly name: string;
  readonly version: string;
  analyze(text: string): Promise<MorphToken[]>;
}

function dictPath(): string {
  const pkg = require.resolve("kuromoji/package.json");
  return path.join(path.dirname(pkg), "dict");
}

let tokenizerPromise: Promise<Tokenizer<IpadicFeatures>> | null = null;

function getKuromoji(): Promise<Tokenizer<IpadicFeatures>> {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: dictPath() }).build((err, tokenizer) => {
        if (err) reject(err);
        else resolve(tokenizer);
      });
    });
  }
  return tokenizerPromise;
}

function hira(value: string | undefined): string | null {
  if (!value || value === "*") return null;
  return kataToHira(value);
}

/** kuromoji + bundled IPADIC. The default primary analyzer. */
export class KuromojiAdapter implements AnalyzerAdapter {
  readonly name = "kuromoji";
  readonly version = "ipadic-0.1.2";

  async analyze(text: string): Promise<MorphToken[]> {
    const tokenizer = await getKuromoji();
    return tokenizer.tokenize(text).map((t): MorphToken => {
      const reading = hira(t.reading);
      return {
        surface: t.surface_form,
        pos: t.pos,
        posDetail: t.pos_detail_1,
        base: t.basic_form && t.basic_form !== "*" ? t.basic_form : t.surface_form,
        reading,
        pronunciation: hira(t.pronunciation ?? t.reading),
        conjugationType: t.conjugated_type && t.conjugated_type !== "*" ? t.conjugated_type : null,
        conjugationForm: t.conjugated_form && t.conjugated_form !== "*" ? t.conjugated_form : null,
        hasKanji: hasKanji(t.surface_form),
        morae: reading ? countMorae(reading) : null,
      };
    });
  }
}

let primary: AnalyzerAdapter = new KuromojiAdapter();

export function getPrimaryAnalyzer(): AnalyzerAdapter {
  return primary;
}

/** Swap the primary analyzer (used by tests and future adapter comparison). */
export function setPrimaryAnalyzer(adapter: AnalyzerAdapter): void {
  primary = adapter;
}
