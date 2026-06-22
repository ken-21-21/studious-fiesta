import { Router } from "express";
import { db } from "../db/index.js";

export const sourcesRouter = Router();

// Every note traces back to a source; this lets the client answer
// "where did this card come from?" for any imported artifact.
sourcesRouter.get("/", (_req, res, next) => {
  try {
    const sources = db
    .prepare(
      `SELECT s.id, s.kind, s.filename, s.hash, s.created_at,
        COUNT(n.id) AS note_count
       FROM sources s
       LEFT JOIN notes n ON n.source_id = s.id
       GROUP BY s.id
       ORDER BY s.created_at DESC`
    )
    .all();
    res.json({ data: sources, error: null });
  } catch (err) {
    next(err);
  }
});

sourcesRouter.get("/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ data: null, error: "Invalid source id" });
      return;
    }
    const source = db.prepare("SELECT * FROM sources WHERE id = ?").get(id);
    if (!source) {
      res.status(404).json({ data: null, error: "Source not found" });
      return;
    }
    res.json({ data: source, error: null });
  } catch (err) {
    next(err);
  }
});
