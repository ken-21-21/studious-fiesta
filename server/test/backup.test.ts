import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { db, DATA_DIR } from "../src/db/index.js";
import { backupRouter } from "../src/routes/backup.js";

describe("database backup", () => {
  it("produces a consistent, independently-openable snapshot", async () => {
    db.prepare("INSERT INTO decks (name) VALUES ('Backup Test Deck')").run();

    const tmpPath = path.join(os.tmpdir(), `backup-test-${Date.now()}.db`);
    try {
      await db.backup(tmpPath);
      expect(fs.existsSync(tmpPath)).toBe(true);

      const snapshot = new Database(tmpPath, { readonly: true });
      const row = snapshot
        .prepare("SELECT name FROM decks WHERE name = ?")
        .get("Backup Test Deck") as { name: string } | undefined;
      expect(row?.name).toBe("Backup Test Deck");
      snapshot.close();
    } finally {
      fs.unlink(tmpPath, () => {});
    }
  });

  it("captures core linked study data (sources, analyses, cards, review logs)", async () => {
    const sourceId = Number(
      db.prepare("INSERT INTO sources (kind, filename, hash) VALUES ('textbook', 'chapter.txt', 'abc123')")
        .run().lastInsertRowid
    );
    const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('Integrity Deck')").run().lastInsertRowid);
    const noteId = Number(
      db.prepare("INSERT INTO notes (deck_id, source, source_id, fields, tags) VALUES (?, 'textbook', ?, ?, 'grammar')")
        .run(deckId, sourceId, JSON.stringify({ sentence: "先生は学校に行きます。" })).lastInsertRowid
    );
    const cardId = Number(
      db.prepare(`
        INSERT INTO cards (note_id, deck_id, card_type, question, answer, media, reps, state)
        VALUES (?, ?, 'listening', ?, ?, ?, 1, 2)
      `).run(
        noteId,
        deckId,
        JSON.stringify({ tts: "先生は学校に行きます。", lang: "ja" }),
        JSON.stringify({ text: "先生は学校に行きます。", lang: "ja" }),
        JSON.stringify({ audio: "backup-audio.mp3" })
      ).lastInsertRowid
    );
    db.prepare(`
      INSERT INTO note_analyses (note_id, kind, surface, label, confidence, band, needs_review, alternatives, evidence, payload)
      VALUES (?, 'reading', '学校', 'がっこう', 0.95, 'high', 0, '[]', '[{"source":"source_furigana"}]', '{}')
    `).run(noteId);
    db.prepare(`
      INSERT INTO review_logs (card_id, rating, state, due, stability, difficulty, elapsed_days, last_elapsed_days, scheduled_days)
      VALUES (?, 3, 2, datetime('now'), 1.2, 4.5, 1, 0, 2)
    `).run(cardId);

    const mediaPath = path.join(DATA_DIR, "media", "backup-audio.mp3");
    fs.writeFileSync(mediaPath, "audio");

    const tmpPath = path.join(os.tmpdir(), `backup-integrity-${Date.now()}.db`);
    try {
      await db.backup(tmpPath);
      const snapshot = new Database(tmpPath, { readonly: true });
      const linked = snapshot
        .prepare(`
          SELECT s.filename AS sourceFile, c.id AS cardId, na.label AS reading, rl.rating AS rating
          FROM cards c
          JOIN notes n ON c.note_id = n.id
          LEFT JOIN sources s ON n.source_id = s.id
          LEFT JOIN note_analyses na ON na.note_id = n.id
          LEFT JOIN review_logs rl ON rl.card_id = c.id
          WHERE c.id = ?
        `)
        .get(cardId) as { sourceFile: string; cardId: number; reading: string; rating: number } | undefined;
      expect(linked?.sourceFile).toBe("chapter.txt");
      expect(linked?.cardId).toBe(cardId);
      expect(linked?.reading).toBe("がっこう");
      expect(linked?.rating).toBe(3);
      snapshot.close();
    } finally {
      fs.unlink(tmpPath, () => {});
      fs.unlink(mediaPath, () => {});
    }
  });
});

describe("backup routes", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use("/api/backup", backupRouter);
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

  describe("GET /api/backup", () => {
    it("downloads a valid sqlite snapshot containing current data", async () => {
      db.prepare("INSERT INTO decks (name) VALUES ('Route Backup Deck')").run();

      const res = await fetch(`${baseUrl}/api/backup`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toMatch(/studious-fiesta-backup-.*\.db/);

      const buf = Buffer.from(await res.arrayBuffer());
      const tmpPath = path.join(os.tmpdir(), `backup-route-test-${Date.now()}.db`);
      fs.writeFileSync(tmpPath, buf);
      try {
        const snapshot = new Database(tmpPath, { readonly: true });
        const row = snapshot
          .prepare("SELECT name FROM decks WHERE name = ?")
          .get("Route Backup Deck") as { name: string } | undefined;
        expect(row?.name).toBe("Route Backup Deck");
        snapshot.close();
      } finally {
        fs.unlink(tmpPath, () => {});
      }
    });

    it("returns 500 when backup creation fails", async () => {
      const spy = vi.spyOn(db, "backup").mockRejectedValue(new Error("simulated backup failure"));
      try {
        const res = await fetch(`${baseUrl}/api/backup`);
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.error).toMatch(/Failed to create backup/);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("GET /api/backup/info", () => {
    it("reports the data dir, media dir, and media file count", async () => {
      const mediaDir = path.join(DATA_DIR, "media");
      const fileName = `info-test-${Date.now()}.bin`;
      fs.writeFileSync(path.join(mediaDir, fileName), "x");
      try {
        const res = await fetch(`${baseUrl}/api/backup/info`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.error).toBeNull();
        expect(body.data.dataDir).toBe(DATA_DIR);
        expect(body.data.mediaDir).toBe(mediaDir);
        expect(body.data.mediaFileCount).toBeGreaterThanOrEqual(1);
      } finally {
        fs.unlink(path.join(mediaDir, fileName), () => {});
      }
    });

    it("returns a zero media file count without erroring when the media dir read fails", async () => {
      // The route swallows readdir errors (e.g. ENOENT, EACCES) and reports 0
      // rather than failing the request — confirm that contract holds.
      const spy = vi.spyOn(fs, "readdirSync").mockImplementation(() => {
        throw new Error("ENOENT: simulated missing directory");
      });
      try {
        const res = await fetch(`${baseUrl}/api/backup/info`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.error).toBeNull();
        expect(body.data.mediaFileCount).toBe(0);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
