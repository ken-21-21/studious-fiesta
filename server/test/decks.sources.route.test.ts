import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { decksRouter } from "../src/routes/decks.js";
import { sourcesRouter } from "../src/routes/sources.js";
import { db } from "../src/db/index.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/decks", decksRouter);
  app.use("/api/sources", sourcesRouter);
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

describe("GET /api/decks", () => {
  it("lists decks with card_count and due_count under data", async () => {
    const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('List Decks Test')").run().lastInsertRowid);
    const res = await fetch(`${baseUrl}/api/decks`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    const found = body.data.find((d: any) => d.id === deckId);
    expect(found).toBeTruthy();
    expect(found.card_count).toBe(0);
    expect(found.due_count).toBe(0);
  });
});

describe("DELETE /api/decks/:id", () => {
  it("deletes an existing deck and returns 204", async () => {
    const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('Delete Me')").run().lastInsertRowid);
    const res = await fetch(`${baseUrl}/api/decks/${deckId}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    const row = db.prepare("SELECT id FROM decks WHERE id = ?").get(deckId);
    expect(row).toBeUndefined();
  });

  it("rejects a non-integer id with 400", async () => {
    const res = await fetch(`${baseUrl}/api/decks/abc`, { method: "DELETE" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
  });

  it("rejects a zero/negative id with 400", async () => {
    const res = await fetch(`${baseUrl}/api/decks/0`, { method: "DELETE" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent deck", async () => {
    const res = await fetch(`${baseUrl}/api/decks/999999999`, { method: "DELETE" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });
});

describe("GET /api/sources", () => {
  it("lists sources with note_count under data", async () => {
    const sourceId = Number(
      db.prepare("INSERT INTO sources (kind, filename) VALUES ('textbook', 'list-test.txt')").run().lastInsertRowid
    );
    const res = await fetch(`${baseUrl}/api/sources`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.data.find((s: any) => s.id === sourceId);
    expect(found).toBeTruthy();
    expect(found.note_count).toBe(0);
  });
});

describe("GET /api/sources/:id", () => {
  it("returns a single source by id", async () => {
    const sourceId = Number(
      db.prepare("INSERT INTO sources (kind, filename) VALUES ('textbook', 'single-test.txt')").run().lastInsertRowid
    );
    const res = await fetch(`${baseUrl}/api/sources/${sourceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(sourceId);
    expect(body.data.filename).toBe("single-test.txt");
  });

  it("rejects a non-integer id with 400", async () => {
    const res = await fetch(`${baseUrl}/api/sources/abc`);
    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent source", async () => {
    const res = await fetch(`${baseUrl}/api/sources/999999999`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });
});
