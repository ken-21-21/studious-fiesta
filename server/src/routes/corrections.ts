import { Router } from "express";
import { addCorrection, type CorrectionKind, type CorrectionScope } from "../lib/corrections.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const correctionsRouter = Router();

const KINDS: CorrectionKind[] = [
  "reading", "tokenization", "grammar", "pitch", "ocr", "asr", "translation", "field_mapping",
];
const SCOPES: CorrectionScope[] = [
  "occurrence", "sentence", "source", "deck", "matching", "global",
];

correctionsRouter.post("/", asyncHandler(async (req, res) => {
  const { kind, surface, context, scope, value, note, sourceId } = req.body ?? {};
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
  const id = await addCorrection({
    kind,
    surface: typeof surface === "string" ? surface : undefined,
    context: typeof context === "string" ? context : undefined,
    scope,
    value: value.trim(),
    note: typeof note === "string" ? note : undefined,
    sourceId: Number.isInteger(sourceId) ? sourceId : undefined,
  });
  res.status(201).json({ data: { id }, error: null });
}));
