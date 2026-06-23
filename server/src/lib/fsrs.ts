import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";
import { db } from "../db/index.js";

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export interface CardRow {
  id: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

// Same clamping rule gradeCard applies to its own output, applied here to
// the *input* row first. A corrupted prior row (e.g. NaN/Infinity from a bad
// migration or direct DB edit) would otherwise reach the scheduler raw —
// ts-fsrs derives `due` from prior stability/elapsed_days internally, before
// gradeCard's post-hoc bound() ever runs, so an unclamped corrupt prior value
// can produce an unpersistable `due` (RangeError: Invalid time value) that
// crashes the whole review instead of degrading gracefully.
function boundInput(val: number, min: number, max: number, fallback: number): number {
  if (typeof val !== "number" || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, val));
}

function rowToFsrsCard(row: CardRow): FsrsCard {
  const due = new Date(row.due);
  return {
    due: Number.isNaN(due.getTime()) ? new Date() : due,
    stability: boundInput(row.stability, 0.01, 36500, 0.1),
    difficulty: boundInput(row.difficulty, 1, 10, 5),
    elapsed_days: boundInput(row.elapsed_days, 0, 36500, 0),
    scheduled_days: boundInput(row.scheduled_days, 0, 36500, 0),
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

export const VALID_RATINGS = [
  Rating.Again,
  Rating.Hard,
  Rating.Good,
  Rating.Easy,
] as const;

const updateCardStmt = db.prepare(`
  UPDATE cards SET
    due = ?, stability = ?, difficulty = ?, elapsed_days = ?,
    scheduled_days = ?, reps = ?, lapses = ?, state = ?, last_review = ?
  WHERE id = ?
`);

const insertReviewLogStmt = db.prepare(`
  INSERT INTO review_logs
    (card_id, rating, state, due, stability, difficulty, elapsed_days, last_elapsed_days, scheduled_days, review)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function gradeCard(row: CardRow, rating: Grade, now = new Date()) {
  const fsrsCard = rowToFsrsCard(row);
  const result = scheduler.next(fsrsCard, now, rating);
  const c = result.card;

  const bound = (val: number, min: number, max: number, fallback: number) => {
    if (typeof val !== "number" || !Number.isFinite(val) || Number.isNaN(val)) return fallback;
    return Math.max(min, Math.min(max, val));
  };

  c.stability = bound(c.stability, 0.01, 36500, 0.1);
  c.difficulty = bound(c.difficulty, 1, 10, 5);
  c.scheduled_days = bound(c.scheduled_days, 0, 36500, 0);
  c.elapsed_days = bound(c.elapsed_days, 0, 36500, 0);
  result.log.elapsed_days = bound(result.log.elapsed_days, 0, 36500, 0);
  result.log.scheduled_days = bound(result.log.scheduled_days, 0, 36500, 0);

  result.log.last_elapsed_days = bound(result.log.last_elapsed_days, 0, 36500, 0);

  const persist = db.transaction(() => {
    updateCardStmt.run(
      c.due.toISOString(),
      c.stability,
      c.difficulty,
      c.elapsed_days,
      c.scheduled_days,
      c.reps,
      c.lapses,
      c.state,
      c.last_review ? c.last_review.toISOString() : null,
      row.id
    );

    insertReviewLogStmt.run(
      row.id,
      rating,
      result.log.state,
      c.due.toISOString(),
      c.stability,
      c.difficulty,
      result.log.elapsed_days,
      result.log.last_elapsed_days,
      result.log.scheduled_days,
      now.toISOString()
    );
  });
  persist();

  return c;
}

export function newCardDefaults() {
  const c = createEmptyCard();
  return {
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
  };
}

export { Rating };
