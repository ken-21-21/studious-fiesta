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
import { backupRouter } from "./routes/backup.js";
import { qaRouter } from "./routes/qa.js";
import { authRouter, requireAuth } from "./routes/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// Session store (in-memory, sufficient for single-user self-hosted app)
const sessions = new Map<string, { createdAt: number }>();

// Simple session middleware
app.use((req: any, _res, next) => {
    const token = req.headers["x-session-token"] as string | undefined;
    if (token && sessions.has(token)) {
          req.authenticated = true;
          req.sessionToken = token;
    } else {
          req.authenticated = false;
    }
    next();
});

// Attach sessions map so auth router can use it
app.set("sessions", sessions);

// Auth routes (login/logout/check) — always public
app.use("/api/auth", authRouter);

// Public health check
app.get("/api/health", (_req, res) => res.json({ data: { ok: true }, error: null }));

// Protected API routes
app.use("/media", requireAuth, express.static(MEDIA_DIR));
app.use("/api/decks", requireAuth, decksRouter);
app.use("/api/import", requireAuth, importsRouter);
app.use("/api/study", requireAuth, studyRouter);
app.use("/api/corrections", requireAuth, correctionsRouter);
app.use("/api/sources", requireAuth, sourcesRouter);
app.use("/api/notes", requireAuth, notesRouter);
app.use("/api/backup", requireAuth, backupRouter);
app.use("/api/qa", requireAuth, qaRouter);

const clientDist = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api|\/media).*/, (_req, res) => {
          res.sendFile(path.join(clientDist, "index.html"));
    });
}

const PORT = Number(process.env.PORT) || 8787;

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(`[${new Date().toISOString()}] Unhandled error in ${req.method} ${req.url}:`, err);
    if (res.headersSent) { return next(err); }
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ data: null, error: err.message || "Internal server error" });
});

app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
