import { Router } from "express";
import { db } from "../db/index.js";

export const decksRouter = Router();

decksRouter.get("/", (_req, res) => {
  const now = new Date().toISOString();
  const decks = db
    .prepare(
      `SELECT d.id, d.name, d.created_at,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS card_count,
        (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id AND c.due <= ?) AS due_count
       FROM decks d ORDER BY d.created_at DESC`
    )
    .all(now);
  res.json(decks);
});

decksRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM decks WHERE id = ?").run(req.params.id);
  res.status(204).end();
});
