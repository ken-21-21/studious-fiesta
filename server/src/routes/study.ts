import { Router } from "express";
import { db } from "../db/index.js";
import { gradeCard, VALID_RATINGS, type CardRow } from "../lib/fsrs.js";
import { parseJsonOrDefault, parseJsonOrThrow } from "../utils/json.js";

export const studyRouter = Router();

const MAX_QUEUE_LIMIT = 200;

studyRouter.get("/queue", (req, res, next) => {
  try {
    let deckId: number | undefined;
    if (req.query.deckId !== undefined) {
      deckId = Number(req.query.deckId);
      if (!Number.isInteger(deckId) || deckId <= 0) {
        res.status(400).json({ data: null, error: "deckId must be a positive integer" });
        return;
      }
    }

    let limit = req.query.limit ? Number(req.query.limit) : 20;
    if (!Number.isInteger(limit) || limit <= 0) {
      res.status(400).json({ data: null, error: "limit must be a positive integer" });
      return;
    }
    limit = Math.min(limit, MAX_QUEUE_LIMIT);

    const now = new Date().toISOString();

    const query = deckId
      ? `SELECT
           c.*,
           n.fields AS note_fields,
           n.source_location,
           s.id AS source_id,
           s.kind AS source_kind,
           s.filename AS source_filename
         FROM cards c
         JOIN notes n ON c.note_id = n.id
         LEFT JOIN sources s ON n.source_id = s.id
         WHERE c.deck_id = ? AND c.due <= ?
         ORDER BY c.due ASC LIMIT ?`
      : `SELECT
           c.*,
           n.fields AS note_fields,
           n.source_location,
           s.id AS source_id,
           s.kind AS source_kind,
           s.filename AS source_filename
         FROM cards c
         JOIN notes n ON c.note_id = n.id
         LEFT JOIN sources s ON n.source_id = s.id
         WHERE c.due <= ?
         ORDER BY c.due ASC LIMIT ?`;

    const rows = deckId
      ? db.prepare(query).all(deckId, now, limit)
      : db.prepare(query).all(now, limit);

    const withFields: any[] = [];
    for (const r of rows as any[]) {
      try {
        withFields.push({
          id: r.id,
          note_id: r.note_id,
          deck_id: r.deck_id,
          card_type: r.card_type,
          due: r.due,
          stability: r.stability,
          difficulty: r.difficulty,
          elapsed_days: r.elapsed_days,
          scheduled_days: r.scheduled_days,
          reps: r.reps,
          lapses: r.lapses,
          state: r.state,
          last_review: r.last_review,
          question: parseJsonOrThrow(r.question, "question"),
          answer: parseJsonOrThrow(r.answer, "answer"),
          media: parseJsonOrThrow(r.media, "media"),
          noteFields: parseJsonOrDefault(r.note_fields, {}),
          provenance: r.source_id
            ? {
                sourceId: r.source_id,
                kind: r.source_kind,
                filename: r.source_filename,
                location: parseJsonOrDefault(r.source_location, undefined),
              }
            : undefined,
        });
      } catch (err) {
        // A single corrupted card payload must not take down the whole queue
        // fetch — skip it and log, the rest of the queue is still usable.
        console.error(`study queue: skipping corrupted card row id=${r.id}`, err);
      }
    }

    res.json({ data: withFields, error: null });
  } catch (err) {
    next(err);
  }
});

studyRouter.post("/cards/:id/review", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ data: null, error: "Invalid card id" });
      return;
    }

    const rating = Number(req.body.rating);
    if (!VALID_RATINGS.includes(rating as (typeof VALID_RATINGS)[number])) {
      res.status(400).json({ data: null, error: "rating must be 1-4 (Again/Hard/Good/Easy)" });
      return;
    }

    const row = db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as CardRow | undefined;
    if (!row) {
      res.status(404).json({ data: null, error: "Card not found" });
      return;
    }

    const updated = gradeCard(row, rating as 1 | 2 | 3 | 4);
    res.json({ data: { due: updated.due, stability: updated.stability, state: updated.state }, error: null });
  } catch (err) {
    next(err);
  }
});
