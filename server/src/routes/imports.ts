import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importApkg } from "../lib/apkgImporter.js";
import { importTextbook } from "../lib/textbookImporter.js";

export const importsRouter = Router();

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 500 * 1024 * 1024 } });

importsRouter.post("/apkg", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const deckName = (req.body.deckName as string) || path.basename(req.file.originalname, ".apkg");
  try {
    const result = await importApkg(req.file.path, deckName);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Failed to import apkg" });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

importsRouter.post("/textbook", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const deckName = (req.body.deckName as string) || path.basename(req.file.originalname);
  try {
    const result = await importTextbook(req.file.path, req.file.mimetype, deckName);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Failed to import textbook" });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});
