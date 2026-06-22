import { Router } from "express";
import { db } from "../db/index.js";
import { gradeCard, type CardRow } from "../lib/fsrs.js";

export const studyRouter = Router();

studyRouter.get("/queue", (req, res) => {
  const deckId = req.query.deckId ? Number(req.query.deckId) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const now = new Date().toISOString();

  const cards = deckId
    ? db
        .prepare(`SELECT * FROM cards WHERE deck_id = ? AND due <= ? ORDER BY due ASC LIMIT ?`)
        .all(deckId, now, limit)
    : db
        .prepare(`SELECT * FROM cards WHERE due <= ? ORDER BY due ASC LIMIT ?`)
        .all(now, limit);

  const withFields = cards.map((c: any) => {
    const note = db.prepare("SELECT fields FROM notes WHERE id = ?").get(c.note_id) as
      | { fields: string }
      | undefined;
    return {
      ...c,
      question: JSON.parse(c.question),
      answer: JSON.parse(c.answer),
      media: JSON.parse(c.media),
      noteFields: note ? JSON.parse(note.fields) : {},
    };
  });

  res.json(withFields);
});

studyRouter.post("/cards/:id/review", (req, res) => {
  const id = Number(req.params.id);
  const rating = Number(req.body.rating);
  if (![1, 2, 3, 4].includes(rating)) {
    return res.status(400).json({ error: "rating must be 1-4 (Again/Hard/Good/Easy)" });
  }

  const row = db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as CardRow | undefined;
  if (!row) return res.status(404).json({ error: "Card not found" });

  const updated = gradeCard(row, rating as 1 | 2 | 3 | 4);
  res.json({ due: updated.due, stability: updated.stability, state: updated.state });
});
