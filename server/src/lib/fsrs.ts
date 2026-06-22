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

function rowToFsrsCard(row: CardRow): FsrsCard {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
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
      result.log.elapsed_days,
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
