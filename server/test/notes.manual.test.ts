import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { notesRouter } from "../src/routes/notes.js";
import { db } from "../src/db/index.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/notes", notesRouter);
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

describe("manual note creation", () => {
  it("creates a new deck and a plain basic card when no deckId is given", async () => {
    const res = await fetch(`${baseUrl}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckName: "Quick Adds", front: "犬", back: "dog" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.noteId).toBeGreaterThan(0);
    expect(body.data.cardId).toBeGreaterThan(0);

    const card = db.prepare("SELECT card_type, question, answer FROM cards WHERE id = ?").get(body.data.cardId) as any;
    expect(card.card_type).toBe("basic");
    expect(JSON.parse(card.question).text).toBe("犬");
    expect(JSON.parse(card.answer).text).toBe("dog");

    const note = db.prepare("SELECT source FROM notes WHERE id = ?").get(body.data.noteId) as any;
    expect(note.source).toBe("manual");
  });

  it("adds to an existing deck when deckId is given", async () => {
    const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('Existing Deck')").run().lastInsertRowid);
    const res = await fetch(`${baseUrl}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckId, front: "猫", back: "cat" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.deckId).toBe(deckId);
  });

  it("rejects a missing front/back", async () => {
    const res = await fetch(`${baseUrl}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckName: "Quick Adds", front: "", back: "dog" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown deckId", async () => {
    const res = await fetch(`${baseUrl}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckId: 999999, front: "犬", back: "dog" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects a front/back over the max field length", async () => {
    const res = await fetch(`${baseUrl}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckName: "Quick Adds", front: "a".repeat(2001), back: "dog" }),
    });
    expect(res.status).toBe(400);
  });

  it("falls back to a default deck name when deckName is blank", async () => {
    const res = await fetch(`${baseUrl}/api/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckName: "   ", front: "鳥", back: "bird" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const deck = db.prepare("SELECT name FROM decks WHERE id = ?").get(body.data.deckId) as any;
    expect(deck.name).toBe("Manual");
  });
});

describe("GET /api/notes/:id/analysis", () => {
  it("returns the note's analyses with evidence/alternatives/correction provenance under data", async () => {
    const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('Analysis Test Deck')").run().lastInsertRowid);
    const noteId = Number(
      db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
        .run(deckId).lastInsertRowid
    );
    db.prepare(`
      INSERT INTO note_analyses
        (note_id, kind, surface, label, span_start, span_end, confidence, band, needs_review,
         analyzer_name, analyzer_version, evidence, alternatives, payload, corrected_by_user)
      VALUES (?, 'reading', '走る', 'はしる', 0, 2, 0.9, 'high', 0, 'kuromoji', '0.1.2', '[]', '[]', '{}', 0)
    `).run(noteId);

    const res = await fetch(`${baseUrl}/api/notes/${noteId}/analysis`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].surface).toBe("走る");
    expect(body.data[0].needsReview).toBe(false);
    expect(body.data[0].correctedByUser).toBe(false);
    expect(body.data[0].span).toEqual({ start: 0, end: 2 });
    expect(body.data[0].analyzer).toEqual({ name: "kuromoji", version: "0.1.2" });
  });

  it("returns an empty array for a note with no analyses", async () => {
    const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('Empty Analysis Deck')").run().lastInsertRowid);
    const noteId = Number(
      db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
        .run(deckId).lastInsertRowid
    );
    const res = await fetch(`${baseUrl}/api/notes/${noteId}/analysis`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it("rejects a non-integer note id with 400", async () => {
    const res = await fetch(`${baseUrl}/api/notes/abc/analysis`);
    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent note", async () => {
    const res = await fetch(`${baseUrl}/api/notes/999999999/analysis`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });
});
