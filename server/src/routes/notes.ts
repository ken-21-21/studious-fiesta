import { Router } from "express";
import { db } from "../db/index.js";

export const notesRouter = Router();

// The persisted linguistic analysis behind a note's cards: every reading
// decision and grammar point, with confidence, band, evidence and the items
// flagged for review. This is what makes a card's claims inspectable.
notesRouter.get("/:id/analysis", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid note id" });
      return;
    }
    const note = db.prepare("SELECT id FROM notes WHERE id = ?").get(id);
    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

  const rows = db
    .prepare(
      `SELECT kind, surface, label, span_start, span_end, confidence, band,
        needs_review, analyzer_name, analyzer_version, evidence, alternatives,
        payload, corrected_by_user, created_at
       FROM note_analyses WHERE note_id = ? ORDER BY span_start, id`
    )
    .all(id) as any[];

  res.json(
    rows.map((r) => ({
      kind: r.kind,
      surface: r.surface,
      label: r.label,
      span: r.span_start == null ? undefined : { start: r.span_start, end: r.span_end },
      confidence: r.confidence,
      band: r.band,
      needsReview: !!r.needs_review,
      analyzer: r.analyzer_name
        ? { name: r.analyzer_name, version: r.analyzer_version }
        : undefined,
      evidence: JSON.parse(r.evidence),
      alternatives: JSON.parse(r.alternatives),
      payload: JSON.parse(r.payload),
      correctedByUser: !!r.corrected_by_user,
      createdAt: r.created_at,
    }))
  );
  } catch (err) {
    next(err);
  }
});
