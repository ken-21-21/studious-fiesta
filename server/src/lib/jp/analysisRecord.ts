// A flat, persistable view of the pipeline's analysis output. Reading decisions
// and grammar annotations are different shapes, but for storage/inspection we
// want one uniform record carrying surface, confidence, band, evidence,
// alternatives, needs-review, and the full original payload for round-tripping.
import type { AnalyzedToken } from "./tokenizer.js";
import type { GrammarAnnotation } from "./grammar.js";
import type { ConfidenceBand, Evidence } from "./types.js";

export interface AnalysisRecord {
  kind: "reading" | "grammar";
  surface: string;
  /** reading: chosen reading (or "?" when uncommitted); grammar: machine label. */
  label: string;
  spanStart: number | null;
  spanEnd: number | null;
  confidence: number;
  band: ConfidenceBand;
  needsReview: boolean;
  analyzerName: string | null;
  analyzerVersion: string | null;
  evidence: Evidence[];
  alternatives: unknown[];
  /** Full ReadingDecision / GrammarAnnotation, preserved verbatim. */
  payload: unknown;
}

function analyzerFromEvidence(evidence: Evidence[]): { name: string | null; version: string | null } {
  const ev = evidence.find((e) => e.analyzer);
  return { name: ev?.analyzer ?? null, version: ev?.analyzerVersion ?? null };
}

/** Build reading-decision records for the content tokens of an analyzed span. */
export function readingRecords(tokens: AnalyzedToken[]): AnalysisRecord[] {
  const records: AnalysisRecord[] = [];
  tokens.forEach((t, i) => {
    const d = t.readingDecision;
    // Only record tokens where the reading is a real, inspectable decision:
    // kanji-bearing content words, or anything we flagged for review.
    if (!t.isContentWord && !d.needsReview) return;
    if (!d.surface) return;
    const { name, version } = analyzerFromEvidence(d.evidence);
    records.push({
      kind: "reading",
      surface: d.surface,
      label: d.selected ?? "?",
      spanStart: i,
      spanEnd: i + 1,
      confidence: d.confidence,
      band: d.band,
      needsReview: d.needsReview,
      analyzerName: name,
      analyzerVersion: version,
      evidence: d.evidence,
      alternatives: d.alternatives,
      payload: d,
    });
  });
  return records;
}

/** Build grammar records from grammar annotations. */
export function grammarRecords(annotations: GrammarAnnotation[]): AnalysisRecord[] {
  return annotations.map((a) => {
    const { name, version } = analyzerFromEvidence(a.evidence);
    return {
      kind: "grammar",
      surface: a.surface,
      label: a.label,
      spanStart: a.span.start,
      spanEnd: a.span.end,
      confidence: a.confidence,
      band: a.band,
      needsReview: a.needsReview,
      analyzerName: name,
      analyzerVersion: version,
      evidence: a.evidence,
      alternatives: a.alternatives,
      payload: a,
    };
  });
}
