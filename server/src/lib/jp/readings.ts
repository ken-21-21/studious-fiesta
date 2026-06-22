import { bandOf, type Evidence, type ReadingCandidate, type ReadingDecision } from "./types.js";
import { lookupAmbiguous } from "./ambiguous.js";
import { getReadingCorrection } from "../corrections.js";

export interface DisambiguateInput {
  surface: string;
  hasKanji: boolean;
  analyzerReading: string | null;
  analyzerName: string;
  analyzerVersion: string;
  /** Reading explicitly supplied by the uploaded source (e.g. Anki ruby). */
  sourceFurigana?: string | null;
  /** Scope key (sentence/source id) so scoped corrections can match. */
  context?: string;
}

function dedupeAlternatives(candidates: ReadingCandidate[], selected: string | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    if (c.reading === selected) continue;
    if (seen.has(c.reading)) continue;
    seen.add(c.reading);
    out.push(c.reading);
  }
  return out;
}

function finalize(
  surface: string,
  selected: string | null,
  candidates: ReadingCandidate[],
  confidence: number,
  evidence: Evidence[],
  needsReview: boolean
): ReadingDecision {
  return {
    surface,
    selected,
    candidates,
    confidence,
    band: bandOf(confidence),
    evidence,
    alternatives: dedupeAlternatives(candidates, selected),
    needsReview,
  };
}

/**
 * Decide how a surface form is read, returning an inspectable decision with
 * candidates, confidence, evidence, alternatives and a needs_review flag.
 *
 * Precedence: user correction > source-provided furigana > ambiguous-spelling
 * knowledge base > analyzer output > (no reading) inference.
 */
export function disambiguateReading(input: DisambiguateInput): ReadingDecision {
  const { surface, hasKanji, analyzerReading, analyzerName, analyzerVersion } = input;
  const analyzerEvidence: Evidence = {
    source: "analyzer",
    detail: analyzerReading ? `${analyzerName} read this as ${analyzerReading}` : `${analyzerName} produced no reading`,
    analyzer: analyzerName,
    analyzerVersion,
  };

  // 1) User correction overrides everything.
  const correction = getReadingCorrection(surface, input.context);
  if (correction) {
    const candidates: ReadingCandidate[] = [
      { reading: correction.value, source: "user_correction", weight: 1, note: correction.note },
    ];
    if (analyzerReading && analyzerReading !== correction.value) {
      candidates.push({ reading: analyzerReading, source: "analyzer", weight: 0.2 });
    }
    return finalize(
      surface,
      correction.value,
      candidates,
      1,
      [{ source: "user_correction", detail: `User-corrected reading (scope: ${correction.scope})` }],
      false
    );
  }

  // 2) Source-provided furigana (e.g. Anki ruby) is highly trustworthy.
  if (input.sourceFurigana) {
    const candidates: ReadingCandidate[] = [
      { reading: input.sourceFurigana, source: "source_furigana", weight: 0.95 },
    ];
    if (analyzerReading && analyzerReading !== input.sourceFurigana) {
      candidates.push({ reading: analyzerReading, source: "analyzer", weight: 0.3 });
    }
    const conflict = !!analyzerReading && analyzerReading !== input.sourceFurigana;
    return finalize(
      surface,
      input.sourceFurigana,
      candidates,
      conflict ? 0.8 : 0.95,
      [
        { source: "source_furigana", detail: "Reading supplied by the uploaded source" },
        analyzerEvidence,
      ],
      false
    );
  }

  // 3) Known context-sensitive spelling: do not silently trust one guess.
  const ambiguous = lookupAmbiguous(surface);
  if (ambiguous) {
    const candidates: ReadingCandidate[] = ambiguous.readings.map((r) => ({
      reading: r.reading,
      source: "ambiguous_kb",
      weight: ambiguous.dominant === r.reading ? 0.7 : 0.4,
      note: r.note,
    }));
    if (analyzerReading && !candidates.some((c) => c.reading === analyzerReading)) {
      candidates.push({ reading: analyzerReading, source: "analyzer", weight: 0.3 });
    }
    const evidence: Evidence[] = [
      {
        source: "ambiguous_kb",
        detail: `Spelling has context-sensitive readings: ${ambiguous.readings
          .map((r) => `${r.reading} (${r.note})`)
          .join("; ")}`,
      },
      analyzerEvidence,
    ];

    if (ambiguous.dominant) {
      const analyzerAgrees = !analyzerReading || analyzerReading === ambiguous.dominant;
      // Dominant reading: usable, but still surface the alternatives. If the
      // analyzer disagrees with the dominant reading, that conflict needs review.
      return finalize(
        surface,
        ambiguous.dominant,
        candidates,
        analyzerAgrees ? 0.7 : 0.4,
        evidence,
        !analyzerAgrees
      );
    }

    // Genuinely ambiguous (no dominant reading): flag for review, keep all.
    const selected =
      analyzerReading && candidates.some((c) => c.reading === analyzerReading)
        ? analyzerReading
        : candidates[0].reading;
    return finalize(surface, selected, candidates, 0.35, evidence, true);
  }

  // 4) Not a known-ambiguous form.
  if (!hasKanji) {
    // Kana-only surface: the reading is essentially the surface itself.
    const selected = analyzerReading ?? null;
    return finalize(
      surface,
      selected,
      selected ? [{ reading: selected, source: "analyzer", weight: 0.95 }] : [],
      selected ? 0.95 : 0.2,
      [analyzerEvidence],
      !selected
    );
  }

  if (analyzerReading) {
    // Kanji word with a confident single analyzer reading (the common case).
    return finalize(
      surface,
      analyzerReading,
      [{ reading: analyzerReading, source: "analyzer", weight: 0.8 }],
      0.8,
      [analyzerEvidence],
      false
    );
  }

  // 5) Kanji present but no reading (unknown word, proper noun, OCR noise).
  return finalize(
    surface,
    null,
    [],
    0.1,
    [
      {
        source: "inference",
        detail: `${analyzerName} could not read this kanji form; likely an unknown word, name, or OCR noise`,
        analyzer: analyzerName,
        analyzerVersion,
      },
    ],
    true
  );
}
