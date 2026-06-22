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

import { syncNoteCards } from "./cardgen.js";

export async function addCorrection(input: CorrectionInput): Promise<number> {
  const res = insertStmt.run({
    kind: input.kind,
    surface: input.surface ?? null,
    context: input.context ?? null,
    scope: input.scope ?? "global",
    value: input.value,
    note: input.note ?? null,
    sourceId: input.sourceId ?? null,
  });
  const id = Number(res.lastInsertRowid);

  if (input.surface) {
    const affectedNotes = db
      .prepare("SELECT DISTINCT note_id FROM note_analyses WHERE kind = ? AND surface = ?")
      .all(input.kind, input.surface) as { note_id: number }[];
    
    // Process sequentially to avoid DB locks
    for (const row of affectedNotes) {
      await syncNoteCards(row.note_id);
    }
  }

  return id;
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
