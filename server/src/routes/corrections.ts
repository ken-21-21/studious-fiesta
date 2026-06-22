import { Router } from "express";
import { addCorrection, type CorrectionKind, type CorrectionScope } from "../lib/corrections.js";

export const correctionsRouter = Router();

const KINDS: CorrectionKind[] = [
  "reading", "tokenization", "grammar", "pitch", "ocr", "asr", "translation", "field_mapping",
];
const SCOPES: CorrectionScope[] = [
  "occurrence", "sentence", "source", "deck", "matching", "global",
];

correctionsRouter.post("/", async (req, res) => {
  const { kind, surface, context, scope, value, note, sourceId } = req.body ?? {};
  if (!KINDS.includes(kind)) {
    return res.status(400).json({ error: `kind must be one of: ${KINDS.join(", ")}` });
  }
  if (typeof value !== "string" || !value.trim()) {
    return res.status(400).json({ error: "value is required" });
  }
  if (scope !== undefined && !SCOPES.includes(scope)) {
    return res.status(400).json({ error: `scope must be one of: ${SCOPES.join(", ")}` });
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
  res.status(201).json({ id });
});
