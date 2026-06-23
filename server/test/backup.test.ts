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
