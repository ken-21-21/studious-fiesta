import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import AdmZip from "adm-zip";
import initSqlJs from "sql.js";
import { importsRouter } from "../src/routes/imports.js";
import { db } from "../src/db/index.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/imports", importsRouter);
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

async function buildApkgBuffer(noteCount = 1): Promise<Buffer> {
  const SQL = await initSqlJs();
  const sqldb = new SQL.Database();
  sqldb.run(`
    CREATE TABLE col (id INTEGER PRIMARY KEY, models TEXT);
    CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT, tags TEXT);
    CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, ord INTEGER);
    INSERT INTO col (id, models) VALUES (1, '{}');
  `);
  const insertNote = sqldb.prepare("INSERT INTO notes (id, mid, flds, tags) VALUES (?, 1, ?, '')");
  const insertCard = sqldb.prepare("INSERT INTO cards (id, nid, ord) VALUES (?, ?, 0)");
  for (let i = 1; i <= noteCount; i++) {
    insertNote.run([i, `front ${i}\x1fback ${i}`]);
    insertCard.run([i, i]);
  }
  insertNote.free();
  insertCard.free();
  const collData = Buffer.from(sqldb.export());
  sqldb.close();

  const zip = new AdmZip();
  zip.addFile("collection.anki21", collData);
  zip.addFile("media", Buffer.from("{}"));
  return zip.toBuffer();
}

describe("POST /api/imports/apkg", () => {
  it("imports a valid .apkg and returns a card count under data", async () => {
    const buf = await buildApkgBuffer();
    const form = new FormData();
    form.append("file", new Blob([buf]), "test-deck.apkg");
    form.append("deckName", "Imported Deck");

    const res = await fetch(`${baseUrl}/api/imports/apkg`, { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.cardsImported).toBe(1);

    const deck = db.prepare("SELECT name FROM decks WHERE name = ?").get("Imported Deck");
    expect(deck).toBeTruthy();
  });

  it("imports a higher-volume .apkg payload without dropping cards", async () => {
    const buf = await buildApkgBuffer(120);
    const form = new FormData();
    form.append("file", new Blob([buf]), "bulk-deck.apkg");
    form.append("deckName", "Bulk Import Deck");

    const res = await fetch(`${baseUrl}/api/imports/apkg`, { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.cardsImported).toBe(120);
  });

  it("falls back to the filename (sans extension) when deckName is blank", async () => {
    const buf = await buildApkgBuffer();
    const form = new FormData();
    form.append("file", new Blob([buf]), "my-cool-deck.apkg");

    const res = await fetch(`${baseUrl}/api/imports/apkg`, { method: "POST", body: form });
    expect(res.status).toBe(200);
    const deck = db.prepare("SELECT name FROM decks WHERE name = ?").get("my-cool-deck");
    expect(deck).toBeTruthy();
  });

  it("sanitizes control characters from deckName", async () => {
    const buf = await buildApkgBuffer();
    const form = new FormData();
    form.append("file", new Blob([buf]), "sanitize-deck.apkg");
    form.append("deckName", "  Safe\tDeck\nName  ");

    const res = await fetch(`${baseUrl}/api/imports/apkg`, { method: "POST", body: form });
    expect(res.status).toBe(200);
    const deck = db.prepare("SELECT name FROM decks WHERE name = ?").get("SafeDeckName");
    expect(deck).toBeTruthy();
  });

  it("rejects a non-.apkg file extension with 400 (multer fileFilter)", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("not a real apkg")]), "notes.txt");

    const res = await fetch(`${baseUrl}/api/imports/apkg`, { method: "POST", body: form });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toMatch(/Unsupported file type/);
  });

  it("rejects a request with no file with 400", async () => {
    const form = new FormData();
    form.append("deckName", "No File Deck");
    const res = await fetch(`${baseUrl}/api/imports/apkg`, { method: "POST", body: form });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/No file uploaded/);
  });

  it("returns 400 with the importer's error message for a corrupt .apkg", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("definitely not a zip file")]), "corrupt.apkg");
    const res = await fetch(`${baseUrl}/api/imports/apkg`, { method: "POST", body: form });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Not a valid \.apkg file/);
  });
});

describe("POST /api/imports/textbook", () => {
  it("accepts a supported media file and returns 202 with a jobId", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("Lesson 1\nVocabulary\n猫 cat")]), "lesson1.txt");
    form.append("deckName", "Textbook Deck");

    const res = await fetch(`${baseUrl}/api/imports/textbook`, { method: "POST", body: form });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(typeof body.data.jobId).toBe("number");
    expect(body.data.jobId).toBeGreaterThan(0);

    const job = db.prepare("SELECT * FROM import_jobs WHERE id = ?").get(body.data.jobId) as any;
    expect(job).toBeTruthy();
    expect(["queued", "running", "done", "error"]).toContain(job.status);
  });

  it("rejects an unsupported file extension with 400", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("binary junk")]), "video.mkv");
    const res = await fetch(`${baseUrl}/api/imports/textbook`, { method: "POST", body: form });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Unsupported file type/);
  });

  it("rejects a request with no file with 400", async () => {
    const form = new FormData();
    const res = await fetch(`${baseUrl}/api/imports/textbook`, { method: "POST", body: form });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/No file uploaded/);
  });

  it("accepts dirty subtitle input and tracks progress to a terminal state", async () => {
    const form = new FormData();
    const noisySubtitles = [
      "WEBVTT",
      "",
      "1",
      "00:00:01.100 --> 00:00:02.100",
      "第1話",
      "",
      "2",
      "00:00:02.100 --> 00:00:03.500",
      "これはテストです。",
      "",
      "3",
      "00:00:03.500 --> 00:00:05.100",
      "先生は学校に行きます。"
    ].join("\n");
    form.append("file", new Blob([Buffer.from(noisySubtitles)]), "episode.vtt");
    form.append("deckName", "Noisy Subtitle Deck");

    const res = await fetch(`${baseUrl}/api/imports/textbook`, { method: "POST", body: form });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(typeof body.data.jobId).toBe("number");

    let terminal: any = null;
    for (let i = 0; i < 60; i++) {
      const jobRes = await fetch(`${baseUrl}/api/imports/jobs/${body.data.jobId}`);
      expect(jobRes.status).toBe(200);
      terminal = (await jobRes.json()).data;
      if (terminal.status === "done" || terminal.status === "error") break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    expect(["done", "error"]).toContain(terminal.status);
    if (terminal.status === "error") {
      throw new Error(`textbook job failed: ${terminal.error}`);
    }
    expect((terminal.cards_created ?? 0)).toBeGreaterThanOrEqual(0);
  });

  it("handles larger noisy .txt imports and still completes", async () => {
    const form = new FormData();
    const lessonLines: string[] = ["Lesson 1", "Vocabulary"];
    for (let i = 0; i < 120; i++) {
      lessonLines.push(`単語${i} たんご${i} word ${i}`);
      if (i % 20 === 0) lessonLines.push(" \t ");
    }
    lessonLines.push("Grammar", "これはテストです。", "学校へ行きます。");
    form.append("file", new Blob([Buffer.from(lessonLines.join("\n"))]), "bulk.txt");
    form.append("deckName", "Bulk Text Deck");

    const res = await fetch(`${baseUrl}/api/imports/textbook`, { method: "POST", body: form });
    expect(res.status).toBe(202);
    const body = await res.json();
    const jobId = body.data.jobId as number;

    let finalStatus = "queued";
    for (let i = 0; i < 80; i++) {
      const poll = await fetch(`${baseUrl}/api/imports/jobs/${jobId}`);
      const job = (await poll.json()).data as any;
      finalStatus = job.status;
      if (job.status === "done" || job.status === "error") break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    expect(finalStatus).toBe("done");
  });
});

describe("GET /api/imports/jobs/:id", () => {
  it("returns the job row under data", async () => {
    const id = Number(
      db.prepare("INSERT INTO import_jobs (kind, filename, status) VALUES ('textbook', 'x.txt', 'queued')")
        .run().lastInsertRowid
    );
    const res = await fetch(`${baseUrl}/api/imports/jobs/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.id).toBe(id);
    expect(body.data.status).toBe("queued");
  });

  it("rejects a non-integer job id with 400", async () => {
    const res = await fetch(`${baseUrl}/api/imports/jobs/abc`);
    expect(res.status).toBe(400);
  });

  it("rejects a zero/negative job id with 400", async () => {
    const res = await fetch(`${baseUrl}/api/imports/jobs/0`);
    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent job", async () => {
    const res = await fetch(`${baseUrl}/api/imports/jobs/999999999`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.data).toBeNull();
    expect(body.error).toMatch(/not found/i);
  });
});
