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

correctionsRouter.post("/", asyncHandler(async (req, res) => {
  const { kind, surface, context, scope, value, note, sourceId, deckId } = req.body ?? {};
  if (!KINDS.includes(kind)) {
    res.status(400).json({ data: null, error: `kind must be one of: ${KINDS.join(", ")}` });
    return;
  }
  if (typeof value !== "string" || !value.trim()) {
    res.status(400).json({ data: null, error: "value is required" });
    return;
  }
  if (scope !== undefined && !SCOPES.includes(scope)) {
    res.status(400).json({ data: null, error: `scope must be one of: ${SCOPES.join(", ")}` });
    return;
  }
  const correctionInput = {
    kind,
    surface: typeof surface === "string" ? surface : undefined,
    context: typeof context === "string" ? context : undefined,
    scope,
    value: value.trim(),
    note: typeof note === "string" ? note : undefined,
    sourceId: Number.isInteger(sourceId) ? sourceId : undefined,
    deckId: Number.isInteger(deckId) ? deckId : undefined,
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
  res.status(201).json({ data: { id, analysesUpdated, cardsUpdated, cardsCreated }, error: null });
}));
