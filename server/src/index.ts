import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MEDIA_DIR } from "./db/index.js";
import { decksRouter } from "./routes/decks.js";
import { importsRouter } from "./routes/imports.js";
import { studyRouter } from "./routes/study.js";
import { correctionsRouter } from "./routes/corrections.js";
import { sourcesRouter } from "./routes/sources.js";
import { notesRouter } from "./routes/notes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use("/media", express.static(MEDIA_DIR));

app.use("/api/decks", decksRouter);
app.use("/api/import", importsRouter);
app.use("/api/study", studyRouter);
app.use("/api/corrections", correctionsRouter);
app.use("/api/sources", sourcesRouter);
app.use("/api/notes", notesRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const clientDist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/media).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const PORT = Number(process.env.PORT) || 8787;

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
