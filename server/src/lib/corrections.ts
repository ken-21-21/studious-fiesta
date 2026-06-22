import { db } from "../db/index.js";

export type CorrectionKind =
  | "reading"
  | "tokenization"
  | "grammar"
  | "pitch"
  | "ocr"
  | "asr"
  | "translation"
  | "field_mapping";

export type CorrectionScope =
  | "occurrence"
  | "sentence"
  | "source"
  | "deck"
  | "matching"
  | "global";

export interface CorrectionInput {
  kind: CorrectionKind;
  surface?: string;
  context?: string;
  scope?: CorrectionScope;
  value: string;
  note?: string;
  sourceId?: number;
}

export interface CorrectionRow extends CorrectionInput {
  id: number;
  scope: CorrectionScope;
  created_at: string;
}

const insertStmt = db.prepare(`
  INSERT INTO corrections (kind, surface, context, scope, value, note, source_id)
  VALUES (@kind, @surface, @context, @scope, @value, @note, @sourceId)
`);

export function addCorrection(input: CorrectionInput): number {
  const res = insertStmt.run({
    kind: input.kind,
    surface: input.surface ?? null,
    context: input.context ?? null,
    scope: input.scope ?? "global",
    value: input.value,
    note: input.note ?? null,
    sourceId: input.sourceId ?? null,
  });
  return Number(res.lastInsertRowid);
}

const selectMatchingAnalysesStmt = db.prepare(
  "SELECT id, note_id, label, alternatives FROM note_analyses WHERE kind = ? AND surface = ?"
);
const reGateAnalysisStmt = db.prepare(`
  UPDATE note_analyses
  SET label = ?, confidence = 1, band = 'high', needs_review = 0,
      corrected_by_user = 1, alternatives = ?, evidence = ?
  WHERE id = ?
`);
const selectNoteCardsStmt = db.prepare("SELECT id, question, answer FROM cards WHERE note_id = ?");
const updateCardStmt = db.prepare("UPDATE cards SET question = ?, answer = ? WHERE id = ?");

// A surface/reading correction patches a card's question/answer JSON in
// place where that payload's text *is* the corrected surface (the whole
// term, not a substring) — so we never guess which part of a multi-word
// field the correction was about.
function applyCorrectionToCardPayload(payload: any, surface: string, value: string): boolean {
  let changed = false;
  if (payload && typeof payload === "object") {
    if (payload.text === surface) {
      if (payload.reading !== value) {
        payload.reading = value;
        changed = true;
      }
      if (payload.readingUncertain) {
        payload.readingUncertain = false;
        changed = true;
      }
    }
    if (Array.isArray(payload.furigana)) {
      for (const seg of payload.furigana) {
        if (seg && seg.text === surface && (seg.reading !== value || seg.uncertain)) {
          seg.reading = value;
          seg.uncertain = false;
          changed = true;
        }
      }
    }
  }
  return changed;
}

/**
 * Back-applies a newly-submitted reading/grammar correction to already
 * persisted `note_analyses` rows and the card payloads derived from them, so
 * existing study material reflects the correction immediately rather than
 * only future analysis runs.
 *
 * Scoped corrections (occurrence/sentence/source/deck) require matching the
 * original analysis context, which `note_analyses` doesn't retroactively
 * store — those are intentionally left for future analysis only (already
 * honored going forward via `getReadingCorrection`). Only `global` and
 * `matching` corrections, which apply regardless of context, are safe to
 * back-apply here.
 */
export function reGateExistingAnalyses(input: CorrectionInput): { analysesUpdated: number; cardsUpdated: number } {
  if (input.kind !== "reading" && input.kind !== "grammar") {
    return { analysesUpdated: 0, cardsUpdated: 0 };
  }
  const scope = input.scope ?? "global";
  if (scope !== "global" && scope !== "matching") {
    return { analysesUpdated: 0, cardsUpdated: 0 };
  }
  if (!input.surface) {
    return { analysesUpdated: 0, cardsUpdated: 0 };
  }

  const rows = selectMatchingAnalysesStmt.all(input.kind, input.surface) as
    { id: number; note_id: number; label: string; alternatives: string }[];

  let analysesUpdated = 0;
  const affectedNoteIds = new Set<number>();
  for (const row of rows) {
    if (row.label === input.value) continue;
    const prevAlternatives: string[] = JSON.parse(row.alternatives || "[]");
    const alternatives = [...new Set([row.label, ...prevAlternatives].filter((a) => a && a !== input.value))];
    const evidence = [{ source: "user_correction", detail: `User-corrected (scope: ${scope})` }];
    reGateAnalysisStmt.run(input.value, JSON.stringify(alternatives), JSON.stringify(evidence), row.id);
    analysesUpdated++;
    affectedNoteIds.add(row.note_id);
  }

  let cardsUpdated = 0;
  for (const noteId of affectedNoteIds) {
    const cards = selectNoteCardsStmt.all(noteId) as { id: number; question: string; answer: string }[];
    for (const c of cards) {
      const question = JSON.parse(c.question);
      const answer = JSON.parse(c.answer);
      const qChanged = applyCorrectionToCardPayload(question, input.surface, input.value);
      const aChanged = applyCorrectionToCardPayload(answer, input.surface, input.value);
      if (qChanged || aChanged) {
        updateCardStmt.run(JSON.stringify(question), JSON.stringify(answer), c.id);
        cardsUpdated++;
      }
    }
  }

  return { analysesUpdated, cardsUpdated };
}

// Specificity ordering so a more local correction wins over a broader one.
const SCOPE_RANK: Record<CorrectionScope, number> = {
  occurrence: 6,
  sentence: 5,
  source: 4,
  deck: 3,
  matching: 2,
  global: 1,
};

/**
 * Find the best-matching reading correction for a surface form. `context`
 * (e.g. a sentence key or source id) lets scoped corrections apply only where
 * relevant; `global` corrections always apply.
 */
export function getReadingCorrection(
  surface: string,
  context?: string
): CorrectionRow | null {
  const rows = db
    .prepare("SELECT * FROM corrections WHERE kind = 'reading' AND surface = ?")
    .all(surface) as any[];
  if (!rows.length) return null;

  let best: any = null;
  let bestRank = -1;
  for (const row of rows) {
    const scope = row.scope as CorrectionScope;
    // Scoped corrections require their context to match the current context.
    if (scope !== "global" && scope !== "matching") {
      if (!context || row.context !== context) continue;
    }
    const rank = SCOPE_RANK[scope] ?? 0;
    if (rank > bestRank) {
      best = row;
      bestRank = rank;
    }
  }
  if (!best) return null;
  return {
    id: best.id,
    kind: best.kind,
    surface: best.surface ?? undefined,
    context: best.context ?? undefined,
    scope: best.scope,
    value: best.value,
    note: best.note ?? undefined,
    sourceId: best.source_id ?? undefined,
    created_at: best.created_at,
  };
}
