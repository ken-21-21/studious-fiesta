import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import multer, { type FileFilterCallback } from "multer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importApkg } from "../lib/apkgImporter.js";
import { importTextbook } from "../lib/textbookImporter.js";

export const importsRouter = Router();

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const MAX_DECK_NAME_LENGTH = 200;

function extFilter(allowed: string[]) {
  return (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      cb(new Error(`Unsupported file type "${ext || "unknown"}". Expected: ${allowed.join(", ")}`));
      return;
    }
    cb(null, true);
  };
}

const uploadApkg = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: extFilter([".apkg"]),
});

const uploadTextbook = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: extFilter([".txt", ".pdf"]),
});

// multer's `fileFilter`/size errors are passed to Express's error pipeline rather than
// the route handler, so route this through a callback that turns them into a clean 400.
function withUpload(middleware: RequestHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        return res.status(400).json({ error: message });
      }
      next();
    });
  };
}

function resolveDeckName(provided: unknown, fallback: string): string {
  const trimmed = typeof provided === "string" ? provided.trim() : "";
  const name = trimmed || fallback;
  return name.slice(0, MAX_DECK_NAME_LENGTH);
}

importsRouter.post("/apkg", withUpload(uploadApkg.single("file")), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const deckName = resolveDeckName(
    req.body.deckName,
    path.basename(req.file.originalname, ".apkg")
  );
  try {
    const result = await importApkg(req.file.path, deckName);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Failed to import apkg" });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

importsRouter.post("/textbook", withUpload(uploadTextbook.single("file")), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const deckName = resolveDeckName(req.body.deckName, path.basename(req.file.originalname));
  try {
    const result = await importTextbook(req.file.path, req.file.originalname, deckName);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Failed to import textbook" });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});
