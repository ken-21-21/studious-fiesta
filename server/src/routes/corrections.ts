import { Router } from "express";
import { addCorrection, reGateExistingAnalyses, type CorrectionKind, type CorrectionScope } from "../lib/corrections.js";
import { createNewlyEnabledCards } from "../lib/cardgen.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const correctionsRouter = Router();

const KINDS: CorrectionKind[] = [
  "reading", "tokenization", "grammar", "pitch", "ocr", "asr", "translation", "field_mapping",
];
const SCOPES: CorrectionScope[] = [
  "occurrence", "sentence", "source", "deck", "matching", "global",
];
const MAX_VALUE_LENGTH = 500;
const MAX_CONTEXT_LENGTH = 2000;
const MAX_SURFACE_LENGTH = 200;
const MAX_NOTE_LENGTH = 1000;
const KANA_READING_RE = /^[\p{sc=Hiragana}\p{sc=Katakana}ーｰ・\s]+$/u;

function normalizeInput(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
}

correctionsRouter.post("/", asyncHandler(async (req, res) => {
  const { kind, surface, context, scope, value, note, sourceId, deckId } = req.body ?? {};
  if (!KINDS.includes(kind)) {
    res.status(400).json({ data: null, error: `kind must be one of: ${KINDS.join(", ")}` });
    return;
  }
  if (typeof value !== "string") {
    res.status(400).json({ data: null, error: "value is required" });
    return;
  }
  const valueTrimmed = normalizeInput(value);
  if (!valueTrimmed) {
    res.status(400).json({ data: null, error: "value is required" });
    return;
  }
  if (valueTrimmed.length > MAX_VALUE_LENGTH) {
    res.status(400).json({ data: null, error: `value must be under ${MAX_VALUE_LENGTH} characters` });
    return;
  }
  if (kind === "reading" && !KANA_READING_RE.test(valueTrimmed)) {
    res.status(400).json({ data: null, error: "reading corrections must be kana text" });
    return;
  }
  if (scope !== undefined && !SCOPES.includes(scope)) {
    res.status(400).json({ data: null, error: `scope must be one of: ${SCOPES.join(", ")}` });
    return;
  }
  const surfaceTrimmed = typeof surface === "string" ? normalizeInput(surface) : undefined;
  if (surface !== undefined && (typeof surface !== "string" || !surfaceTrimmed || surfaceTrimmed.length > MAX_SURFACE_LENGTH)) {
    res.status(400).json({ data: null, error: `surface must be a non-empty string under ${MAX_SURFACE_LENGTH} characters` });
    return;
  }
  const contextTrimmed = typeof context === "string" ? normalizeInput(context) : undefined;
  if (context !== undefined && (typeof context !== "string" || (contextTrimmed?.length ?? 0) > MAX_CONTEXT_LENGTH)) {
    res.status(400).json({ data: null, error: `context must be under ${MAX_CONTEXT_LENGTH} characters` });
    return;
  }
  const noteTrimmed = typeof note === "string" ? normalizeInput(note) : undefined;
  if (note !== undefined && (typeof note !== "string" || (noteTrimmed?.length ?? 0) > MAX_NOTE_LENGTH)) {
    res.status(400).json({ data: null, error: `note must be under ${MAX_NOTE_LENGTH} characters` });
    return;
  }
  if (sourceId !== undefined && (!Number.isInteger(sourceId) || sourceId <= 0)) {
    res.status(400).json({ data: null, error: "sourceId must be a positive integer" });
    return;
  }
  if (deckId !== undefined && (!Number.isInteger(deckId) || deckId <= 0)) {
    res.status(400).json({ data: null, error: "deckId must be a positive integer" });
    return;
  }
  const correctionInput = {
    kind,
    surface: surfaceTrimmed,
    context: contextTrimmed,
    scope,
    value: valueTrimmed,
    note: noteTrimmed,
    sourceId: sourceId as number | undefined,
    deckId: deckId as number | undefined,
  };
  const id = addCorrection(correctionInput);

  // Two-part re-gating: (1) patch existing analyses + card payloads in place
  // (scope-aware, provenance-preserving), then (2) create any card types the
  // now-confident reading newly unlocks (e.g. a pitch card that was gated out).
  const { analysesUpdated, cardsUpdated, affectedNoteIds } = reGateExistingAnalyses(correctionInput);
  let cardsCreated = 0;
  for (const noteId of affectedNoteIds) {
    cardsCreated += await createNewlyEnabledCards(noteId);
  }
  console.info(
    `[corrections] kind=${kind} scope=${scope ?? "global"} id=${id} analysesUpdated=${analysesUpdated} cardsUpdated=${cardsUpdated} cardsCreated=${cardsCreated}`
  );
  res.status(201).json({ data: { id, analysesUpdated, cardsUpdated, cardsCreated }, error: null });
}));
