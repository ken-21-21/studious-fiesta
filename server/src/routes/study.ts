import { Router } from "express";
import { db } from "../db/index.js";
import { gradeCard, VALID_RATINGS, type CardRow } from "../lib/fsrs.js";

export const studyRouter = Router();

const MAX_QUEUE_LIMIT = 200;

studyRouter.get("/queue", (req, res) => {
  let deckId: number | undefined;
  if (req.query.deckId !== undefined) {
    deckId = Number(req.query.deckId);
    if (!Number.isInteger(deckId) || deckId <= 0) {
      return res.status(400).json({ error: "deckId must be a positive integer" });
    }
  }

  let limit = req.query.limit ? Number(req.query.limit) : 20;
  if (!Number.isInteger(limit) || limit <= 0) {
    return res.status(400).json({ error: "limit must be a positive integer" });
  }
  limit = Math.min(limit, MAX_QUEUE_LIMIT);

  const now = new Date().toISOString();

  const cards = deckId
    ? db
        .prepare(`SELECT * FROM cards WHERE deck_id = ? AND due <= ? ORDER BY due ASC LIMIT ?`)
        .all(deckId, now, limit)
    : db
        .prepare(`SELECT * FROM cards WHERE due <= ? ORDER BY due ASC LIMIT ?`)
        .all(now, limit);

  const withFields = cards.map((c: any) => {
    const note = db
      .prepare(
        `SELECT n.fields, n.source_location, s.id AS source_id, s.kind AS source_kind, s.filename AS source_filename
         FROM notes n LEFT JOIN sources s ON s.id = n.source_id
         WHERE n.id = ?`
      )
      .get(c.note_id) as
      | { fields: string; source_location: string | null; source_id: number | null; source_kind: string | null; source_filename: string | null }
      | undefined;
    return {
      ...c,
      question: JSON.parse(c.question),
      answer: JSON.parse(c.answer),
      media: JSON.parse(c.media),
      noteFields: note ? JSON.parse(note.fields) : {},
      provenance: note?.source_id
        ? {
            sourceId: note.source_id,
            kind: note.source_kind,
            filename: note.source_filename,
            location: note.source_location ? JSON.parse(note.source_location) : undefined,
          }
        : undefined,
    };
  });

  res.json(withFields);
});

studyRouter.post("/cards/:id/review", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid card id" });
  }

  const rating = Number(req.body.rating);
  if (!VALID_RATINGS.includes(rating as (typeof VALID_RATINGS)[number])) {
    return res.status(400).json({ error: "rating must be 1-4 (Again/Hard/Good/Easy)" });
  }

  const row = db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as CardRow | undefined;
  if (!row) return res.status(404).json({ error: "Card not found" });

  const updated = gradeCard(row, rating as 1 | 2 | 3 | 4);
  res.json({ due: updated.due, stability: updated.stability, state: updated.state });
});
