import { Router } from "express";
import { db } from "../db/index.js";
import { newCardDefaults } from "../lib/fsrs.js";
import { parseJsonOrThrow } from "../utils/json.js";

export const notesRouter = Router();

const MAX_FIELD_LENGTH = 2000;
const MAX_DECK_NAME_LENGTH = 200;

// Quick single-card entry, distinct from the bulk apkg/textbook import
// pipelines. Deliberately makes no linguistic claims (no reading/pitch
// analysis) — it's a plain front/back card, same shape as an apkg "basic"
// card, so there's nothing here that needs gating under the JP-analysis
// invariant.
notesRouter.post("/", (req, res, next) => {
  try {
    const { deckId, deckName, front, back, tags } = req.body ?? {};
    if (typeof front !== "string" || !front.trim()) {
      return res.status(400).json({ data: null, error: "front is required" });
    }
    if (typeof back !== "string" || !back.trim()) {
      return res.status(400).json({ data: null, error: "back is required" });
    }
    if (front.length > MAX_FIELD_LENGTH || back.length > MAX_FIELD_LENGTH) {
      return res.status(400).json({ data: null, error: `front/back must be under ${MAX_FIELD_LENGTH} characters` });
    }

    if (deckId !== undefined) {
      if (!Number.isInteger(deckId) || deckId <= 0) {
        return res.status(400).json({ data: null, error: "Invalid deckId" });
      }
      const deck = db.prepare("SELECT id FROM decks WHERE id = ?").get(deckId);
      if (!deck) return res.status(404).json({ data: null, error: "Deck not found" });
    }

    const frontTrimmed = front.trim();
    const backTrimmed = back.trim();

    // Deck creation, note insert, and card insert must all succeed together —
    // otherwise a failure between steps (e.g. disk full) could leave a note
    // with no card, or a freshly created empty deck behind.
    const createNote = db.transaction(() => {
      let resolvedDeckId: number;
      if (deckId !== undefined) {
        resolvedDeckId = deckId;
      } else {
        const trimmed = typeof deckName === "string" ? deckName.trim() : "";
        const name = (trimmed || "Manual").slice(0, MAX_DECK_NAME_LENGTH);
        resolvedDeckId = Number(db.prepare("INSERT INTO decks (name) VALUES (?)").run(name).lastInsertRowid);
      }

      const noteId = Number(
        db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', ?, ?)")
          .run(
            resolvedDeckId,
            JSON.stringify({ Front: frontTrimmed, Back: backTrimmed }),
            typeof tags === "string" ? tags : ""
          ).lastInsertRowid
      );

      const d = newCardDefaults();
      const cardId = Number(
        db.prepare(`
          INSERT INTO cards (note_id, deck_id, card_type, question, answer,
            due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state)
          VALUES (?, ?, 'basic', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          noteId,
          resolvedDeckId,
          JSON.stringify({ text: frontTrimmed }),
          JSON.stringify({ text: backTrimmed }),
          d.due, d.stability, d.difficulty, d.elapsed_days, d.scheduled_days, d.reps, d.lapses, d.state
        ).lastInsertRowid
      );

      return { noteId, cardId, deckId: resolvedDeckId };
    });

    const result = createNote();
    res.status(201).json({ data: result, error: null });
  } catch (err) {
    next(err);
  }
});

// The persisted linguistic analysis behind a note's cards: every reading
// decision and grammar point, with confidence, band, evidence and the items
// flagged for review. This is what makes a card's claims inspectable.
notesRouter.get("/:id/analysis", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ data: null, error: "Invalid note id" });
      return;
    }
    const note = db.prepare("SELECT id FROM notes WHERE id = ?").get(id);
    if (!note) {
      res.status(404).json({ data: null, error: "Note not found" });
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

    const analyses: any[] = [];
    for (const r of rows) {
      try {
        analyses.push({
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
          evidence: parseJsonOrThrow(r.evidence, "evidence"),
          alternatives: parseJsonOrThrow(r.alternatives, "alternatives"),
          payload: parseJsonOrThrow(r.payload, "payload"),
          correctedByUser: !!r.corrected_by_user,
          createdAt: r.created_at,
        });
      } catch (err) {
        // A corrupted analysis row must not break the whole analysis listing
        // for a note — skip it and log, the rest remain inspectable.
        console.error(`note analysis: skipping corrupted note_analyses row for note ${id}`, err);
      }
    }

    res.json({ data: analyses, error: null });
  } catch (err) {
    next(err);
  }
});
