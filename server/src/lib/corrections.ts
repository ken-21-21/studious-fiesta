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

const VALID_KINDS = new Set<CorrectionKind>([
  "reading", "tokenization", "grammar", "pitch", "ocr", "asr", "translation", "field_mapping"
]);
const VALID_SCOPES = new Set<CorrectionScope>([
  "occurrence", "sentence", "source", "deck", "matching", "global"
]);

export async function addCorrection(input: CorrectionInput): Promise<number> {
  if (!VALID_KINDS.has(input.kind)) throw new Error(`Invalid correction kind: ${input.kind}`);
  
  const scope = input.scope ?? "global";
  if (!VALID_SCOPES.has(scope)) throw new Error(`Invalid correction scope: ${scope}`);

  const sanitize = (s: string | undefined): string | null => {
    if (typeof s !== "string") return null;
    const cleaned = s.replace(/[\u0000]/g, "").trim();
    return cleaned.length > 0 ? cleaned : null;
  };

  const value = sanitize(input.value);
  if (!value) throw new Error("Correction value cannot be empty or malformed");

  const surface = sanitize(input.surface);
  const context = sanitize(input.context);
  const note = sanitize(input.note);

  const res = insertStmt.run({
    kind: input.kind,
    surface,
    context,
    scope,
    value,
    note,
    sourceId: typeof input.sourceId === "number" ? input.sourceId : null,
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
