import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import multer, { type FileFilterCallback } from "multer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importApkg } from "../lib/apkgImporter.js";
import { createTextbookJob, getJob } from "../lib/jobs.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const importsRouter = Router();

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const MAX_DECK_NAME_LENGTH = 200;
const MAX_FILENAME_LENGTH = 255;

function extFilter(allowed: string[]) {
  return (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (file.originalname.length > MAX_FILENAME_LENGTH || file.originalname.includes("\0")) {
      cb(new Error("Invalid filename"));
      return;
    }
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
  limits: { 
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 1024 * 1024 
  },
  fileFilter: extFilter([".apkg"]),
});

const uploadMedia = multer({
  dest: os.tmpdir(),
  limits: { 
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 1024 * 1024 
  },
  fileFilter: extFilter([
    ".txt", ".pdf", ".epub",
    ".png", ".jpg", ".jpeg", ".webp",
    ".mp3", ".wav", ".m4a", ".mp4",
    ".srt", ".vtt"
  ]),
});

// multer's `fileFilter`/size errors are passed to Express's error pipeline rather than
// the route handler, so route this through a callback that turns them into a clean 400 (or 413).
function withUpload(middleware: RequestHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({ data: null, error: "File too large" });
          }
          return res.status(400).json({ data: null, error: err.message });
        }
        const message = err instanceof Error ? err.message : "Upload failed";
        return res.status(400).json({ data: null, error: message });
      }
      next();
    });
  };
}

function resolveDeckName(provided: unknown, fallback: string): string {
  const sanitize = (value: string) => value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  const trimmed = typeof provided === "string" ? sanitize(provided) : "";
  const name = trimmed || sanitize(fallback) || "Imported";
  return name.slice(0, MAX_DECK_NAME_LENGTH);
}

importsRouter.post("/apkg", withUpload(uploadApkg.single("file")), asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400).json({ data: null, error: "No file uploaded" });
    return;
  }
  const deckName = resolveDeckName(
    req.body.deckName,
    path.basename(req.file.originalname, ".apkg")
  );
  try {
    const result = await importApkg(req.file.path, deckName, req.file.originalname);
    res.json({ data: result, error: null });
  } catch (err: any) {
    res.status(400).json({ data: null, error: err.message ?? "Failed to import apkg" });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
}));

// Textbooks can be large, so they are processed as a background job (one
// lesson at a time). Returns a jobId the client polls for progress.
importsRouter.post("/textbook", withUpload(uploadMedia.single("file")), (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ data: null, error: "No file uploaded" });
      return;
    }
    const deckName = resolveDeckName(req.body.deckName, path.basename(req.file.originalname));
    try {
      const jobId = createTextbookJob(req.file.path, req.file.originalname, deckName);
      res.status(202).json({ data: { jobId }, error: null });
    } catch (err: any) {
      fs.unlink(req.file.path, () => {});
      res.status(400).json({ data: null, error: err.message ?? "Failed to start import" });
    }
  } catch (err) {
    next(err);
  }
});

importsRouter.get("/jobs/:id", (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ data: null, error: "Invalid job id" });
      return;
    }
    const job = getJob(id);
    if (!job) {
      res.status(404).json({ data: null, error: "Job not found" });
      return;
    }
    res.json({ data: job, error: null });
  } catch (err) {
    next(err);
  }
});
