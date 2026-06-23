import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { studyRouter } from "../src/routes/study.js";
import { db } from "../src/db/index.js";
import { newCardDefaults } from "../src/lib/fsrs.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/study", studyRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

function makeCard(opts: { deckId?: number; due?: string } = {}) {
  const deckId = opts.deckId ?? Number(db.prepare("INSERT INTO decks (name) VALUES ('Study Route Deck')").run().lastInsertRowid);
  const noteId = Number(
    db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
      .run(deckId).lastInsertRowid
  );
  const d = newCardDefaults();
  const due = opts.due ?? new Date(Date.now() - 1000).toISOString(); // due now
  const cardId = Number(
    db.prepare(`
      INSERT INTO cards (note_id, deck_id, card_type, question, answer,
        due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state)
      VALUES (?, ?, 'basic', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      noteId, deckId,
      JSON.stringify({ text: "front" }),
      JSON.stringify({ text: "back" }),
      due, d.stability, d.difficulty, d.elapsed_days, d.scheduled_days, d.reps, d.lapses, d.state
    ).lastInsertRowid
  );
  return { deckId, noteId, cardId };
}

describe("GET /api/study/queue", () => {
  it("returns due cards in the uniform {data, error} envelope", async () => {
    const { cardId } = makeCard();
    const res = await fetch(`${baseUrl}/api/study/queue`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((c: any) => c.id === cardId)).toBe(true);
  });

  it("filters by deckId when provided", async () => {
    const { deckId, cardId } = makeCard();
    makeCard(); // a card in a different deck
    const res = await fetch(`${baseUrl}/api/study/queue?deckId=${deckId}`);
    const body = await res.json();
    expect(body.data.every((c: any) => c.deck_id === deckId)).toBe(true);
    expect(body.data.some((c: any) => c.id === cardId)).toBe(true);
  });

  it("rejects a non-integer deckId with 400", async () => {
    const res = await fetch(`${baseUrl}/api/study/queue?deckId=abc`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toMatch(/deckId/);
  });

  it("rejects a negative deckId with 400", async () => {
    const res = await fetch(`${baseUrl}/api/study/queue?deckId=-1`);
    expect(res.status).toBe(400);
  });

  it("rejects a non-positive limit with 400", async () => {
    const res = await fetch(`${baseUrl}/api/study/queue?limit=0`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/limit/);
  });

  it("caps an excessive limit at MAX_QUEUE_LIMIT rather than erroring", async () => {
    const res = await fetch(`${baseUrl}/api/study/queue?limit=999999`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("excludes cards not yet due", async () => {
    const farFuture = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString();
    const { cardId } = makeCard({ due: farFuture });
    const res = await fetch(`${baseUrl}/api/study/queue?limit=200`);
    const body = await res.json();
    expect(body.data.some((c: any) => c.id === cardId)).toBe(false);
  });
});

describe("POST /api/study/cards/:id/review", () => {
  it("grades a card and returns updated FSRS fields under data", async () => {
    const { cardId } = makeCard();
    const res = await fetch(`${baseUrl}/api/study/cards/${cardId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 3 }), // Good
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.due).toBeTruthy();
    expect(typeof body.data.stability).toBe("number");
    expect(typeof body.data.state).toBe("number");

    const persisted = db.prepare("SELECT reps FROM cards WHERE id = ?").get(cardId) as any;
    expect(persisted.reps).toBe(1);
  });

  it("rejects a non-integer card id with 400", async () => {
    const res = await fetch(`${baseUrl}/api/study/cards/abc/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 3 }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-range rating with 400", async () => {
    const { cardId } = makeCard();
    const res = await fetch(`${baseUrl}/api/study/cards/${cardId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 7 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/rating/);
  });

  it("rejects a missing rating with 400", async () => {
    const { cardId } = makeCard();
    const res = await fetch(`${baseUrl}/api/study/cards/${cardId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent card", async () => {
    const res = await fetch(`${baseUrl}/api/study/cards/999999999/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 3 }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.data).toBeNull();
  });

  it("supports long sequential review sessions without losing updates", async () => {
    const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('Long Session Deck')").run().lastInsertRowid);
    const cardIds: number[] = [];
    for (let i = 0; i < 45; i++) {
      const created = makeCard({ deckId });
      cardIds.push(created.cardId);
    }

    for (const cardId of cardIds) {
      const res = await fetch(`${baseUrl}/api/study/cards/${cardId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: 3 }),
      });
      expect(res.status).toBe(200);
    }

    const reviewedCount = (
      db.prepare("SELECT COUNT(*) AS c FROM cards WHERE deck_id = ? AND reps > 0").get(deckId) as { c: number }
    ).c;
    expect(reviewedCount).toBe(45);
  });
});
