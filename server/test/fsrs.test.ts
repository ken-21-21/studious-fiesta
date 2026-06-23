import { describe, it, expect } from "vitest";
import { db } from "../src/db/index.js";
import { gradeCard, newCardDefaults, VALID_RATINGS, Rating, type CardRow } from "../src/lib/fsrs.js";

function insertCard(overrides: Partial<CardRow> = {}): { id: number; row: CardRow } {
  const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('FSRS Test Deck')").run().lastInsertRowid);
  const noteId = Number(
    db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
      .run(deckId).lastInsertRowid
  );
  const d = newCardDefaults();
  const merged = { ...d, ...overrides };
  const id = Number(
    db.prepare(`
      INSERT INTO cards (note_id, deck_id, card_type, question, answer,
        due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review)
      VALUES (?, ?, 'basic', '{}', '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      noteId, deckId,
      merged.due, merged.stability, merged.difficulty, merged.elapsed_days,
      merged.scheduled_days, merged.reps, merged.lapses, merged.state,
      (merged as any).last_review ?? null
    ).lastInsertRowid
  );
  const row = db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as CardRow;
  return { id, row };
}

describe("fsrs scheduling", () => {
  it("VALID_RATINGS contains exactly Again/Hard/Good/Easy (1-4)", () => {
    expect([...VALID_RATINGS].sort()).toEqual([1, 2, 3, 4]);
  });

  it("newCardDefaults produces a fresh, unreviewed card state", () => {
    const d = newCardDefaults();
    expect(d.reps).toBe(0);
    expect(d.lapses).toBe(0);
    expect(d.state).toBe(0); // New
  });

  it("schedules a brand-new card forward in time on a Good rating", () => {
    const { row } = insertCard();
    const now = new Date("2024-01-01T00:00:00Z");
    const updated = gradeCard(row, Rating.Good, now);
    expect(updated.due.getTime()).toBeGreaterThan(now.getTime());
    expect(updated.reps).toBe(1);
    expect(updated.stability).toBeGreaterThan(0);
  });

  it("persists the updated FSRS state back to the cards table", () => {
    const { id, row } = insertCard();
    const now = new Date("2024-01-01T00:00:00Z");
    gradeCard(row, Rating.Good, now);
    const persisted = db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as any;
    expect(persisted.reps).toBe(1);
    expect(persisted.last_review).toBe(now.toISOString());
  });

  it("writes a review_logs row on every grade", () => {
    const { id, row } = insertCard();
    const now = new Date("2024-01-01T00:00:00Z");
    gradeCard(row, Rating.Again, now);
    const log = db.prepare("SELECT * FROM review_logs WHERE card_id = ?").get(id) as any;
    expect(log).toBeTruthy();
    expect(log.rating).toBe(Rating.Again);
    expect(log.review).toBe(now.toISOString());
  });

  it("increments lapses on an Again rating for a card already in review state", () => {
    const { row } = insertCard({ state: 2, stability: 10, difficulty: 5, reps: 3 } as Partial<CardRow>);
    const updated = gradeCard(row, Rating.Again, new Date("2024-01-01T00:00:00Z"));
    expect(updated.lapses).toBe(1);
    expect(updated.state).toBe(3); // Relearning
  });

  // --- bound() clamping behavior (private helper inside gradeCard, exercised
  // indirectly via pathological pre-existing row state) ---

  it("clamps an out-of-range stability on the input row instead of blowing up", () => {
    // A corrupted/extreme prior stability value (e.g. from a bad migration)
    // must not propagate or crash scheduling; ts-fsrs's own output is what
    // ultimately gets clamped, but feeding it a wild prior must still yield
    // a finite, in-range result.
    const { row } = insertCard({ stability: 999999, difficulty: 5, state: 2, reps: 5 } as Partial<CardRow>);
    const updated = gradeCard(row, Rating.Good, new Date("2024-01-01T00:00:00Z"));
    expect(Number.isFinite(updated.stability)).toBe(true);
    expect(updated.stability).toBeGreaterThanOrEqual(0.01);
    expect(updated.stability).toBeLessThanOrEqual(36500);
  });

  it("clamps difficulty into [1, 10] even from an out-of-range prior", () => {
    const { row } = insertCard({ difficulty: -50, stability: 5, state: 2, reps: 5 } as Partial<CardRow>);
    const updated = gradeCard(row, Rating.Hard, new Date("2024-01-01T00:00:00Z"));
    expect(updated.difficulty).toBeGreaterThanOrEqual(1);
    expect(updated.difficulty).toBeLessThanOrEqual(10);
    expect(Number.isFinite(updated.difficulty)).toBe(true);
  });

  it("never persists NaN/Infinity stability/difficulty even with a NaN-seeded prior row", () => {
    // sqlite can't store NaN/Infinity via a NOT NULL REAL column, so this
    // pathological prior state (e.g. corrupted via direct DB manipulation,
    // or a future schema relaxation) is constructed in-memory rather than
    // inserted, to isolate gradeCard's defensive clamping of the *input* row
    // (rowToFsrsCard's boundInput), not just its output.
    const { row: base } = insertCard({ state: 2, reps: 2 } as Partial<CardRow>);
    const row: CardRow = {
      ...base,
      stability: NaN,
      difficulty: Infinity,
    };
    const updated = gradeCard(row, Rating.Good, new Date("2024-01-01T00:00:00Z"));
    for (const v of [updated.stability, updated.difficulty]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Number.isNaN(v)).toBe(false);
    }
  });

  it("recovers gracefully from an Infinity/NaN elapsed_days or an unparseable due on the prior row instead of crashing the review", () => {
    // Regression test for a real bug: ts-fsrs derives `due` from the prior
    // row's raw stability/elapsed_days before gradeCard's post-hoc bound()
    // ever runs, so a corrupted prior value used to produce an unpersistable
    // `due` (RangeError: Invalid time value), crashing the whole review
    // instead of degrading gracefully. Fixed by clamping inputs in
    // rowToFsrsCard (src/lib/fsrs.ts) before they reach the scheduler.
    const { row: base } = insertCard({ state: 2, reps: 2 } as Partial<CardRow>);
    const rowBadElapsed: CardRow = { ...base, elapsed_days: -Infinity };
    expect(() => gradeCard(rowBadElapsed, Rating.Good, new Date("2024-01-01T00:00:00Z"))).not.toThrow();

    const { row: base2 } = insertCard({ state: 2, reps: 2 } as Partial<CardRow>);
    const rowBadDue: CardRow = { ...base2, due: "not-a-date" };
    const updated = gradeCard(rowBadDue, Rating.Good, new Date("2024-01-01T00:00:00Z"));
    expect(Number.isNaN(updated.due.getTime())).toBe(false);
  });

  it("handles every rating value (Again/Hard/Good/Easy) without throwing", () => {
    for (const rating of VALID_RATINGS) {
      const { row } = insertCard();
      expect(() => gradeCard(row, rating, new Date("2024-01-01T00:00:00Z"))).not.toThrow();
    }
  });
});
