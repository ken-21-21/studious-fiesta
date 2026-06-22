import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { db } from "../src/db/index.js";

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
