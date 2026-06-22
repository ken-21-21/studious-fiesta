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
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid deck id" });
  }

  const result = db.prepare("DELETE FROM decks WHERE id = ?").run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: "Deck not found" });
  }
  res.status(204).end();
});
