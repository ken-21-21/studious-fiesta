// Shared analysis types. The whole pipeline is built around the principle that
// every derived claim carries evidence, confidence, and alternatives, so the
// system can be explicit about what it knows vs. guesses.

/** Where a piece of evidence came from, in rough order of trustworthiness. */
export type EvidenceSource =
  | "user_correction" // a correction the user made — overrides everything
  | "source_furigana" // ruby/reading supplied by the uploaded material itself
  | "audio_alignment" // observed in aligned native audio
  | "dictionary" // dictionary / reference lookup
  | "analyzer" // morphological analyzer (kuromoji, …)
  | "ambiguous_kb" // known context-sensitive-spelling knowledge base
  | "inference"; // model / heuristic inference, weakest

export type ConfidenceBand = "high" | "medium" | "low";

export interface Evidence {
  source: EvidenceSource;
  detail: string;
  analyzer?: string;
  analyzerVersion?: string;
}

export interface ReadingCandidate {
  /** Hiragana reading. */
  reading: string;
  source: EvidenceSource;
  /** Relative plausibility weight in [0,1]. */
  weight: number;
  note?: string;
}

/**
 * The outcome of deciding how a surface form is read in context. Designed so a
 * reviewer can see the chosen reading, every alternative, why it was chosen,
 * how confident we are, and whether it must be reviewed before being trusted.
 */
export interface ReadingDecision {
  surface: string;
  /** Chosen hiragana reading, or null if we decline to commit. */
  selected: string | null;
  candidates: ReadingCandidate[];
  confidence: number; // 0..1
  band: ConfidenceBand;
  evidence: Evidence[];
  /** Readings other than the selected one, preserved for inspection/correction. */
  alternatives: string[];
  /** True when this should not become trusted study material without review. */
  needsReview: boolean;
}

export function bandOf(confidence: number): ConfidenceBand {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}
