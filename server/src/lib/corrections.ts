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
  /** Target deck for scope='deck' corrections. */
  deckId?: number;
}

export interface CorrectionRow extends CorrectionInput {
  id: number;
  scope: CorrectionScope;
  created_at: string;
}

const insertStmt = db.prepare(`
  INSERT INTO corrections (kind, surface, context, scope, value, note, source_id, deck_id)
  VALUES (@kind, @surface, @context, @scope, @value, @note, @sourceId, @deckId)
`);

const VALID_KINDS = new Set<CorrectionKind>([
  "reading", "tokenization", "grammar", "pitch", "ocr", "asr", "translation", "field_mapping"
]);
const VALID_SCOPES = new Set<CorrectionScope>([
  "occurrence", "sentence", "source", "deck", "matching", "global"
]);

function sanitize(s: string | undefined): string | null {
  if (typeof s !== "string") return null;
  const cleaned = s.replace(/[\u0000]/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function addCorrection(input: CorrectionInput): number {
  if (!VALID_KINDS.has(input.kind)) throw new Error(`Invalid correction kind: ${input.kind}`);

  const scope = input.scope ?? "global";
  if (!VALID_SCOPES.has(scope)) throw new Error(`Invalid correction scope: ${scope}`);

  const value = sanitize(input.value);
  if (!value) throw new Error("Correction value cannot be empty or malformed");

  const res = insertStmt.run({
    kind: input.kind,
    surface: sanitize(input.surface),
    context: sanitize(input.context),
    scope,
    value,
    note: sanitize(input.note),
    sourceId: typeof input.sourceId === "number" ? input.sourceId : null,
    deckId: typeof input.deckId === "number" ? input.deckId : null,
  });
  return Number(res.lastInsertRowid);
}

const selectMatchingAnalysesStmt = db.prepare(`
  SELECT na.id, na.note_id, na.label, na.alternatives, n.deck_id, n.source_id
  FROM note_analyses na
  JOIN notes n ON n.id = na.note_id
  WHERE na.kind = ? AND na.surface = ?
`);
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
 * `deck` and `source` scope are resolved via each analysis's note's
 * `deck_id`/`source_id` — both already recorded on `notes`, so no extra
 * context needs to be stored. `occurrence` and `sentence` scope require
 * matching the original sentence/position context, which `note_analyses`
 * doesn't retroactively store — those remain forward-only (and, today, the
 * generation pipeline doesn't thread that context through either, so they
 * are effectively inert; see PROJECT_STATUS.md).
 */
export function reGateExistingAnalyses(input: CorrectionInput): {
  analysesUpdated: number;
  cardsUpdated: number;
  affectedNoteIds: number[];
} {
  if (input.kind !== "reading" && input.kind !== "grammar") {
    return { analysesUpdated: 0, cardsUpdated: 0, affectedNoteIds: [] };
  }
  const scope = input.scope ?? "global";
  if (scope !== "global" && scope !== "matching" && scope !== "source" && scope !== "deck") {
    return { analysesUpdated: 0, cardsUpdated: 0, affectedNoteIds: [] };
  }
  if (scope === "source" && !input.sourceId) {
    return { analysesUpdated: 0, cardsUpdated: 0, affectedNoteIds: [] };
  }
  if (scope === "deck" && !input.deckId) {
    return { analysesUpdated: 0, cardsUpdated: 0, affectedNoteIds: [] };
  }
  if (!input.surface) {
    return { analysesUpdated: 0, cardsUpdated: 0, affectedNoteIds: [] };
  }

  const allRows = selectMatchingAnalysesStmt.all(input.kind, input.surface) as
    { id: number; note_id: number; label: string; alternatives: string; deck_id: number; source_id: number | null }[];
  const rows =
    scope === "source"
      ? allRows.filter((r) => r.source_id === input.sourceId)
      : scope === "deck"
      ? allRows.filter((r) => r.deck_id === input.deckId)
      : allRows;

  let analysesUpdated = 0;
  const affectedNoteIds = new Set<number>();
  for (const row of rows) {
    if (row.label === input.value) continue;
    try {
      const prevAlternatives: string[] = JSON.parse(row.alternatives || "[]");
      const alternatives = [...new Set([row.label, ...prevAlternatives].filter((a) => a && a !== input.value))];
      const evidence = [{ source: "user_correction", detail: `User-corrected (scope: ${scope})` }];
      reGateAnalysisStmt.run(input.value, JSON.stringify(alternatives), JSON.stringify(evidence), row.id);
      analysesUpdated++;
      affectedNoteIds.add(row.note_id);
    } catch (err) {
      // A corrupted alternatives payload on one row must not abort the
      // whole correction batch — log and keep processing the rest.
      console.error(`reGateExistingAnalyses: skipping corrupt note_analyses row id=${row.id}`, err);
    }
  }

  let cardsUpdated = 0;
  for (const noteId of affectedNoteIds) {
    const cards = selectNoteCardsStmt.all(noteId) as { id: number; question: string; answer: string }[];
    for (const c of cards) {
      try {
        const question = JSON.parse(c.question);
        const answer = JSON.parse(c.answer);
        const qChanged = applyCorrectionToCardPayload(question, input.surface, input.value);
        const aChanged = applyCorrectionToCardPayload(answer, input.surface, input.value);
        if (qChanged || aChanged) {
          updateCardStmt.run(JSON.stringify(question), JSON.stringify(answer), c.id);
          cardsUpdated++;
        }
      } catch (err) {
        // Same defense for the card payload patch: a corrupted card row is
        // skipped, not fatal to the rest of the batch.
        console.error(`reGateExistingAnalyses: skipping corrupt card row id=${c.id}`, err);
      }
    }
  }

  return { analysesUpdated, cardsUpdated, affectedNoteIds: [...affectedNoteIds] };
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
