import { Router } from "express";
import { db } from "../db/index.js";

export const decksRouter = Router();

decksRouter.get("/", (_req, res, next) => {
  try {
    const now = new Date().toISOString();
    const decks = db
      .prepare(
        `SELECT d.id, d.name, d.created_at,
          COUNT(c.id) AS card_count,
          COALESCE(SUM(CASE WHEN c.due <= ? THEN 1 ELSE 0 END), 0) AS due_count
         FROM decks d
         LEFT JOIN cards c ON c.deck_id = d.id
         GROUP BY d.id
         ORDER BY d.created_at DESC`
      )
      .all(now);
    res.json({ data: decks, error: null });
  } catch (err) {
    next(err);
  }
});

decksRouter.delete("/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ data: null, error: "Invalid deck id" });
    }

    const result = db.prepare("DELETE FROM decks WHERE id = ?").run(id);
    if (result.changes === 0) {
      res.status(404).json({ data: null, error: "Deck not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
