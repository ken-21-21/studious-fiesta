import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { correctionsRouter } from "../src/routes/corrections.js";
import { db } from "../src/db/index.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/corrections", correctionsRouter);
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

async function post(body: unknown) {
  const res = await fetch(`${baseUrl}/api/corrections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("POST /api/corrections", () => {
  it("creates a correction and returns counts under data, not at the top level", async () => {
    // A manual note (no 'vocabulary' tag, no fields.sentence) so
    // createNewlyEnabledCards is a guaranteed no-op and the test stays
    // hermetic (no network/API calls).
    const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('Route Corrections Deck')").run().lastInsertRowid);
    const noteId = Number(
      db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
        .run(deckId).lastInsertRowid
    );
    db.prepare(`
      INSERT INTO note_analyses (note_id, kind, surface, label, confidence, band, needs_review, alternatives, evidence, payload)
      VALUES (?, 'reading', '入力', 'にゅうりょく', 0.4, 'low', 1, '[]', '[]', '{}')
    `).run(noteId);

    const { status, body } = await post({
      kind: "reading",
      surface: "入力",
      value: "いれちから",
      scope: "global",
    });

    expect(status).toBe(201);
    expect(body.error).toBeNull();
    expect(typeof body.data.id).toBe("number");
    expect(body.data.analysesUpdated).toBe(1);
    expect(body.data.cardsUpdated).toBe(0);
    expect(body.data.cardsCreated).toBe(0);
    // Top-level body must NOT carry these fields directly (uniform envelope).
    expect((body as any).analysesUpdated).toBeUndefined();
  });

  it("rejects an invalid kind with 400", async () => {
    const { status, body } = await post({ kind: "nonsense", value: "x" });
    expect(status).toBe(400);
    expect(body.data).toBeNull();
    expect(body.error).toMatch(/kind/);
  });

  it("rejects a missing value with 400", async () => {
    const { status, body } = await post({ kind: "reading" });
    expect(status).toBe(400);
    expect(body.error).toMatch(/value/);
  });

  it("rejects a whitespace-only value with 400", async () => {
    const { status } = await post({ kind: "reading", value: "   " });
    expect(status).toBe(400);
  });

  it("rejects an invalid scope with 400", async () => {
    const { status, body } = await post({ kind: "reading", value: "あ", scope: "bogus" });
    expect(status).toBe(400);
    expect(body.error).toMatch(/scope/);
  });

  it("defaults scope to global when omitted and still succeeds", async () => {
    const { status, body } = await post({ kind: "reading", surface: "全然", value: "ぜんぜん" });
    expect(status).toBe(201);
    const row = db.prepare("SELECT scope FROM corrections WHERE id = ?").get(body.data.id) as any;
    expect(row.scope).toBe("global");
  });

  it("rejects non-integer sourceId/deckId", async () => {
    const { status, body } = await post({
      kind: "reading",
      surface: "適当",
      value: "てきとう",
      sourceId: "not-a-number",
      deckId: 3.5,
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/sourceId|deckId/);
  });

  it("rejects an oversized correction value", async () => {
    const { status, body } = await post({
      kind: "reading",
      value: "x".repeat(501),
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/under 500/);
  });

  it("rejects non-kana reading corrections", async () => {
    const { status, body } = await post({
      kind: "reading",
      surface: "学校",
      value: "school",
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/kana/i);
  });

  it("normalizes control characters from input fields before persistence", async () => {
    const { status, body } = await post({
      kind: "grammar",
      surface: "  丁寧語\t\n",
      context: "  lesson-1\u0007 ",
      value: "  polite form\t ",
      note: "\u0000 keep this note \n",
    });
    expect(status).toBe(201);
    const row = db
      .prepare("SELECT surface, context, value, note FROM corrections WHERE id = ?")
      .get(body.data.id) as any;
    expect(row.surface).toBe("丁寧語");
    expect(row.context).toBe("lesson-1");
    expect(row.value).toBe("polite form");
    expect(row.note).toBe("keep this note");
  });
});
