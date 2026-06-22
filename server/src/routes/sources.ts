import { Router } from "express";
import { db } from "../db/index.js";

export const sourcesRouter = Router();

// Every note traces back to a source; this lets the client answer
// "where did this card come from?" for any imported artifact.
sourcesRouter.get("/", (_req, res) => {
  const sources = db
    .prepare(
      `SELECT s.id, s.kind, s.filename, s.hash, s.created_at,
        (SELECT COUNT(*) FROM notes n WHERE n.source_id = s.id) AS note_count
       FROM sources s ORDER BY s.created_at DESC`
    )
    .all();
  res.json(sources);
});

sourcesRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid source id" });
  }
  const source = db.prepare("SELECT * FROM sources WHERE id = ?").get(id);
  if (!source) return res.status(404).json({ error: "Source not found" });
  res.json(source);
});
