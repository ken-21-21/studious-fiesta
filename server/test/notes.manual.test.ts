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
    expect(body.noteId).toBeGreaterThan(0);
    expect(body.cardId).toBeGreaterThan(0);

    const card = db.prepare("SELECT card_type, question, answer FROM cards WHERE id = ?").get(body.cardId) as any;
    expect(card.card_type).toBe("basic");
    expect(JSON.parse(card.question).text).toBe("犬");
    expect(JSON.parse(card.answer).text).toBe("dog");

    const note = db.prepare("SELECT source FROM notes WHERE id = ?").get(body.noteId) as any;
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
    expect(body.deckId).toBe(deckId);
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
});
