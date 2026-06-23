import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db/index.js";
import { newCardDefaults } from "./fsrs.js";
import { segmentTextbook, type Lesson } from "./segment.js";
import { generateLessonNotes, type NoteSpec } from "./cardgen.js";
import { isJapaneseDoc } from "./lang.js";
import { ensurePitchData } from "./jp/pitch.js";

async function extractMediaText(filePath: string, originalFilename: string): Promise<string> {
  const ext = path.extname(originalFilename).toLowerCase();
  
  if (ext === ".pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    return (await pdfParse(fs.readFileSync(filePath))).text;
  }
  
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
    const tesseract = await import("tesseract.js").catch(() => {
      throw new Error("OCR requires tesseract.js. Please run `npm install tesseract.js` in the server directory.");
    });
    const result = await tesseract.recognize(filePath, "jpn");
    return result.data.text;
  }
  
  if ([".mp3", ".wav", ".m4a", ".mp4"].includes(ext)) {
    const whisper = (await import("whisper-node").catch(() => {
      throw new Error("ASR requires whisper-node. Please run `npm install whisper-node` in the server directory.");
    })).default;
    // whisper-node creates a transcript from the audio file
    const transcript = await whisper(filePath, { language: 'ja', task: 'transcribe' });
    if (Array.isArray(transcript)) {
      return transcript.map((s: any) => s.speech || s.text || "").join("\n");
    }
    return typeof transcript === "string" ? transcript : JSON.stringify(transcript);
  }
  
  if (ext === ".epub") {
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(filePath);
    let fullText = "";
    for (const entry of zip.getEntries()) {
      if (!entry.isDirectory && entry.entryName.match(/\.(x?html)$/i)) {
        const html = entry.getData().toString("utf8");
        const text = html
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/&amp;/gi, "&")
          .replace(/\s+/g, " ")
          .trim();
        fullText += text + "\n\n";
      }
    }
    return fullText;
  }
  
  const rawText = fs.readFileSync(filePath, "utf-8");
  
  if (ext === ".srt" || ext === ".vtt") {
    return rawText
      .split(/\r?\n/)
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (trimmed === "WEBVTT") return false;
        if (/^\d+$/.test(trimmed)) return false;
        if (trimmed.includes("-->")) return false;
        return true;
      })
      .join("\n");
  }

  return rawText;
}

function lessonLabel(lesson: Lesson): string {
  if (lesson.number != null) {
    return `Lesson ${lesson.number}${lesson.title ? `: ${lesson.title}` : ""}`;
  }
  return lesson.title || "Lesson";
}

const insertSourceStmt = db.prepare("INSERT INTO sources (kind, filename, hash) VALUES (?, ?, ?)");
const insertDeckStmt = db.prepare("INSERT INTO decks (name) VALUES (?)");
const insertNoteStmt = db.prepare(
  "INSERT INTO notes (deck_id, source, source_id, source_location, fields, tags) VALUES (?, 'textbook', ?, ?, ?, ?)"
);
const insertCardStmt = db.prepare(`
  INSERT INTO cards (note_id, deck_id, card_type, question, answer, media,
    due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertAnalysisStmt = db.prepare(`
  INSERT INTO note_analyses (note_id, kind, surface, label, span_start, span_end,
    confidence, band, needs_review, analyzer_name, analyzer_version, evidence, alternatives, payload)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.pipe(hash).on("finish", () => {
      resolve(hash.digest("hex"));
    });
  });
}

// Insert one lesson's notes+cards atomically and return (deckId, cardCount).
const persistLesson = db.transaction(
  (deckName: string, notes: NoteSpec[], sourceId: number, location: Record<string, unknown>) => {
    const deckId = Number(insertDeckStmt.run(deckName).lastInsertRowid);
    let cardCount = 0;
    for (const note of notes) {
      const noteId = Number(
        insertNoteStmt
          .run(deckId, sourceId, JSON.stringify(location), JSON.stringify(note.fields), note.tags)
          .lastInsertRowid
      );
      for (const a of note.analysis ?? []) {
        insertAnalysisStmt.run(
          noteId,
          a.kind,
          a.surface,
          a.label,
          a.spanStart,
          a.spanEnd,
          a.confidence,
          a.band,
          a.needsReview ? 1 : 0,
          a.analyzerName,
          a.analyzerVersion,
          JSON.stringify(a.evidence),
          JSON.stringify(a.alternatives),
          JSON.stringify(a.payload)
        );
      }
      for (const card of note.cards) {
        const d = newCardDefaults();
        insertCardStmt.run(
          noteId,
          deckId,
          card.cardType,
          JSON.stringify(card.question),
          JSON.stringify(card.answer),
          JSON.stringify(card.media ?? {}),
          d.due, d.stability, d.difficulty, d.elapsed_days, d.scheduled_days,
          d.reps, d.lapses, d.state
        );
        cardCount++;
      }
    }
    return { deckId, cardCount };
  }
);

function updateJob(id: number, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  const sql = `UPDATE import_jobs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => fields[k]), id);
}

export function createTextbookJob(filePath: string, originalFilename: string, baseDeckName: string): number {
  const id = Number(
    db.prepare("INSERT INTO import_jobs (kind, filename, status) VALUES ('textbook', ?, 'queued')")
      .run(originalFilename).lastInsertRowid
  );
  // Run in the background; the job owns the temp file and cleans it up.
  void runTextbookJob(id, filePath, originalFilename, baseDeckName);
  return id;
}

async function runTextbookJob(id: number, filePath: string, originalFilename: string, baseDeckName: string) {
  try {
    updateJob(id, { status: "running", message: "Reading document…" });
    const hash = await hashFile(filePath);
    const sourceId = Number(
      insertSourceStmt.run("textbook", originalFilename, hash).lastInsertRowid
    );
    const text = await extractMediaText(filePath, originalFilename);

    if (isJapaneseDoc(text)) {
      updateJob(id, { message: "Preparing Japanese pitch-accent data…" });
      // Best-effort: if this fails, pitch lookups simply return null later.
      await ensurePitchData().catch(() => {});
    }

    const lessons = segmentTextbook(text).filter((l) => l.sections.length > 0);
    const multi = lessons.length > 1;
    updateJob(id, { total: lessons.length, message: `Detected ${lessons.length} lesson(s)` });

    const createdDecks: { id: number; name: string; cards: number }[] = [];
    let totalCards = 0;

    for (let i = 0; i < lessons.length; i++) {
      const lesson = lessons[i];
      const label = lessonLabel(lesson);
      updateJob(id, { message: `Indexing ${multi ? label : baseDeckName}…` });

      const notes = await generateLessonNotes(lesson);
      if (notes.length === 0) {
        updateJob(id, { progress: i + 1 });
        continue;
      }

      const deckName = multi ? `${baseDeckName} — ${label}` : baseDeckName;
      const location = { lesson: lesson.number ?? null, label };
      const { deckId, cardCount } = persistLesson(deckName, notes, sourceId, location);
      createdDecks.push({ id: deckId, name: deckName, cards: cardCount });
      totalCards += cardCount;
      updateJob(id, { progress: i + 1, cards_created: totalCards });
    }

    updateJob(id, {
      status: "done",
      message: `Created ${createdDecks.length} deck(s), ${totalCards} cards`,
      result: JSON.stringify({ decks: createdDecks, totalCards }),
    });
  } catch (err: any) {
    updateJob(id, { status: "error", error: err?.message ?? "Import failed" });
  } finally {
    fs.unlink(filePath, () => {});
  }
}

export function getJob(id: number) {
  return db.prepare("SELECT * FROM import_jobs WHERE id = ?").get(id);
}
