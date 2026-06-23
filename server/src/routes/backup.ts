import { Router } from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db, DATA_DIR } from "../db/index.js";

export const backupRouter = Router();

// The DB runs in WAL mode, so just copying app.db could miss data still in
// the -wal file. better-sqlite3's .backup() uses SQLite's online backup API,
// which produces a consistent snapshot regardless of WAL state.
backupRouter.get("/", async (_req, res) => {
  const tmpDir = path.resolve(os.tmpdir());
  const tmpPath = path.resolve(tmpDir, `backup-${Date.now()}-${process.pid}.db`);
  // Defense in depth: the filename above is built entirely from trusted,
  // non-attacker-controlled values (Date.now()/process.pid), but confirm the
  // resolved path is still confined to the temp dir before touching the
  // filesystem, in case that ever changes.
  if (tmpPath !== tmpDir && !tmpPath.startsWith(tmpDir + path.sep)) {
    return res.status(500).json({ data: null, error: "Failed to create backup" });
  }
  try {
    await db.backup(tmpPath);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    res.download(tmpPath, `studious-fiesta-backup-${stamp}.db`, (err) => {
      fs.unlink(tmpPath, () => {});
      if (err && !res.headersSent) {
        res.status(500).json({ data: null, error: "Backup download failed" });
      }
    });
  } catch (err) {
    fs.unlink(tmpPath, () => {});
    res.status(500).json({ data: null, error: "Failed to create backup" });
  }
});

// Media files are referenced by filename from card rows but live on disk,
// outside the DB snapshot above — surface where they are so the user can
// back them up too (e.g. tar the directory) rather than silently dropping them.
backupRouter.get("/info", (_req, res) => {
  const mediaDir = path.join(DATA_DIR, "media");
  let mediaFileCount = 0;
  try {
    mediaFileCount = fs.readdirSync(mediaDir).length;
  } catch {
    mediaFileCount = 0;
  }
  res.json({ data: { dataDir: DATA_DIR, mediaDir, mediaFileCount }, error: null });
});
