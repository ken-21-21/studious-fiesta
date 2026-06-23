import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/index.js";
import { newCardDefaults } from "./fsrs.js";
import { segmentTextbook, type Lesson } from "./segment.js";
import { generateLessonNotes, type NoteSpec } from "./cardgen.js";
import { isJapaneseDoc } from "./lang.js";
import { ensurePitchData } from "./jp/pitch.js";

export async function extractMediaText(filePath: string, originalFilename: string): Promise<string> {
  const ext = path.extname(originalFilename).toLowerCase();
  
  if (ext === ".pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(fs.readFileSync(filePath));
    const text: string = result.text;
    const numpages: number = (result as any).numpages ?? 0;
    // Scanned / image-only PDFs have no embedded text layer; pdf-parse extracts
    // near-empty text.  Detect this early rather than silently producing 0 cards.
    // Threshold: fewer than 50 characters per page is almost certainly a scan.
    if (numpages > 0 && text.trim().length < numpages * 50) {
      throw new Error(
        `This PDF appears to be a scanned image with no extractable text layer ` +
        `(${numpages} page${numpages === 1 ? "" : "s"}, ` +
        `${text.trim().length} characters extracted). ` +
        `Try exporting individual page images (.png / .jpg) and importing those — ` +
        `the image OCR path will extract the text.`
      );
    }
    return text;
  }
  
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required for OCR.");
    }
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const imageData = fs.readFileSync(filePath).toString("base64");
    const mimeTypes: Record<string, "image/png" | "image/jpeg" | "image/webp"> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
    };
    const mediaType = mimeTypes[ext];
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192, // raised from 4096 to reduce truncation risk on dense pages
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageData } },
            { type: "text", text: "Transcribe all Japanese text visible in this image verbatim. Output only the raw text with no commentary, explanation, or translation." },
          ],
        },
      ],
    });
    // Detect truncation: if the model hit max_tokens the output is incomplete.
    if (response.stop_reason === "max_tokens") {
      throw new Error(
        "The image contains more text than could be processed in one pass (OCR response was truncated at max_tokens). " +
        "Try cropping the image to a smaller section and re-importing."
      );
    }
    const block = response.content[0];
    return block.type === "text" ? block.text : "";
  }
  
  if ([".mp3", ".wav", ".m4a", ".mp4"].includes(ext)) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required for audio transcription.");
    }
    const audioBlob = new Blob([fs.readFileSync(filePath)]);
    const form = new FormData();
    form.append("file", audioBlob, path.basename(filePath));
    form.append("model", "gpt-4o-mini-transcribe");
    form.append("language", "ja");
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY },
      body: form,
    });
    if (!response.ok) {
      throw new Error(`OpenAI transcription request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json() as { text: string };
    return data.text;
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
          // Strip <rt> content (furigana readings) BEFORE stripping remaining tags.
          // Without this, <ruby>漢字<rt>かんじ</rt></ruby> would become "漢字かんじ"
          // in the extracted text, corrupting tokenisation for furigana-heavy EPUBs.
          .replace(/<rt[^>]*>[\s\S]*?<\/rt>/gi, "")
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
  
  // Default path: plain text.  Validate UTF-8 strictly rather than silently
  // accepting mojibake from e.g. Shift-JIS encoded Japanese .txt files.
  let rawText: string;
  try {
    rawText = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(filePath));
  } catch {
    throw new Error(
      `"${originalFilename}" does not appear to be valid UTF-8. ` +
      `Japanese .txt files are sometimes Shift-JIS encoded — ` +
      `please re-save the file as UTF-8 before importing.`
    );
  }
  
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
