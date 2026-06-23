import AdmZip from "adm-zip";
import initSqlJs from "sql.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, MEDIA_DIR } from "../db/index.js";
import { newCardDefaults } from "./fsrs.js";
import { vocabNote, type NoteSpec } from "./cardgen.js";

// Caps on *uncompressed* size, checked against zip header metadata before any
// entry is decompressed — multer's upload limit only bounds the compressed
// .apkg on disk, so without this a small crafted archive (zip bomb) could
// decompress to gigabytes and exhaust memory.
const MAX_ENTRY_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 200MB per file (collection db or one media file)
const MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024; // 1GB across the whole archive

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSql() {
  if (!SQL) SQL = await initSqlJs();
  return SQL;
}

// Anki stores HTML-ish fields separated by \x1f, with [sound:file] and <img src="file"> refs.
function extractMediaRefs(field: string): { images: string[]; audio: string[] } {
  const images = [...field.matchAll(/<img[^>]+src=["']?([^"'>\s]+)/gi)].map((m) => m[1]);
  const audio = [...field.matchAll(/\[sound:([^\]]+)\]/gi)].map((m) => m[1]);
  return { images, audio };
}

function stripTags(html: string): string {
  return html.replace(/\[sound:[^\]]+\]/gi, "").replace(/<[^>]+>/g, "").trim();
}

export async function importApkg(filePath: string, deckName: string, originalFilename = deckName) {
  let zip: AdmZip;
  try {
    zip = new AdmZip(filePath);
  } catch {
    throw new Error("Not a valid .apkg file (could not read as a zip archive)");
  }
  const entries = zip.getEntries();

  let totalUncompressed = 0;
  for (const entry of entries) {
    const size = entry.header.size;
    if (size > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error(`Archive entry "${entry.entryName}" is too large when decompressed`);
    }
    totalUncompressed += size;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error("Archive is too large when decompressed");
    }
  }

  const collEntry =
    entries.find((e) => e.entryName === "collection.anki21") ??
    entries.find((e) => e.entryName === "collection.anki2");
  if (!collEntry) throw new Error("Not a valid .apkg file (no collection db found)");

  const mediaEntry = entries.find((e) => e.entryName === "media");
  let mediaMap: Record<string, string> = {};
  if (mediaEntry) {
    try {
      mediaMap = JSON.parse(mediaEntry.getData().toString("utf-8"));
    } catch {
      throw new Error("Not a valid .apkg file (media manifest is corrupt)");
    }
  }

  // mediaMap: { "0": "filename.mp3", ... } numeric entry name -> original filename
  const origNameToStored: Record<string, string> = {};
  for (const [num, originalName] of Object.entries(mediaMap)) {
    const entry = entries.find((e) => e.entryName === num);
    if (!entry) continue;
    const safeName = `${Date.now()}_${num}_${path.basename(originalName)}`;
    try {
      fs.writeFileSync(path.join(MEDIA_DIR, safeName), entry.getData());
    } catch (err: any) {
      throw new Error(
        `Failed to write media file "${originalName}" during import: ${err?.message ?? err}`
      );
    }
    origNameToStored[originalName] = safeName;
  }

  const sqljs = await getSql();
  let sqlDb: InstanceType<typeof sqljs.Database>;
  try {
    sqlDb = new sqljs.Database(collEntry.getData());
  } catch {
    throw new Error("Not a valid .apkg file (collection database is corrupt)");
  }

  let notesExist = false;
  try {
    const checkRes = sqlDb.exec("SELECT 1 FROM notes LIMIT 1");
    notesExist = checkRes.length > 0 && checkRes[0].values.length > 0;
  } catch {}

  if (!notesExist) {
    sqlDb.close();
    throw new Error("No notes found in this .apkg file");
  }

  const insertSource = db.prepare("INSERT INTO sources (kind, filename, hash) VALUES ('apkg', ?, ?)");
  const insertDeck = db.prepare("INSERT INTO decks (name) VALUES (?)");
  const insertNote = db.prepare(
    "INSERT INTO notes (deck_id, source, source_id, source_location, fields, tags) VALUES (?, 'apkg', ?, ?, ?, ?)"
  );
  const insertCard = db.prepare(`
    INSERT INTO cards (note_id, deck_id, card_type, question, answer, media,
      due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAnalysis = db.prepare(`
    INSERT INTO note_analyses (note_id, kind, surface, label, span_start, span_end,
      confidence, band, needs_review, analyzer_name, analyzer_version, evidence, alternatives, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const fileHash = await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.pipe(hash).on("finish", () => {
      resolve(hash.digest("hex"));
    });
  });

  const setupTransaction = db.transaction(() => {
    const sourceId = Number(insertSource.run(originalFilename, fileHash).lastInsertRowid);
    const deckRow = insertDeck.run(deckName);
    const deckId = Number(deckRow.lastInsertRowid);
    return { sourceId, deckId };
  });

  const { sourceId, deckId } = setupTransaction();

  const colStmt = sqlDb.prepare("SELECT models FROM col");
  colStmt.step(); // advance to the first (and only) row before reading
  const [modelsJson] = colStmt.get() as [string];
  colStmt.free();
  let models: Record<string, any> = {};
  if (modelsJson) {
    try {
      models = JSON.parse(modelsJson);
    } catch {}
  }

  const modelSamples = new Map<string, string[][]>();
  try {
    const sampleStmt = sqlDb.prepare("SELECT mid, flds FROM notes LIMIT 1000");
    while (sampleStmt.step()) {
      const [mid, flds] = sampleStmt.get() as [number, string];
      const midStr = String(mid);
      let samples = modelSamples.get(midStr);
      if (!samples) {
        samples = [];
        modelSamples.set(midStr, samples);
      }
      if (samples.length < 10) {
        samples.push(flds.split("\x1f"));
      }
    }
    sampleStmt.free();
  } catch (e) {
    console.error("Error reading samples:", e);
  }

  type FieldMapping = { japaneseIdx: number; readingIdx: number; meaningIdx: number; audioIdx: number; isJapaneseDeck: boolean };
  const modelFieldMap = new Map<string, FieldMapping>();
  const insertCorrection = db.prepare(
    "INSERT INTO corrections (kind, scope, source_id, context, value) VALUES ('field_mapping', 'source', ?, ?, ?)"
  );

  db.transaction(() => {
    for (const [midStr, model] of Object.entries(models)) {
      if (!model.flds) continue;
      const fieldNames: string[] = model.flds.map((f: any) => f.name);
      const samples = modelSamples.get(midStr) || [];

      let japaneseIdx = -1;
      let readingIdx = -1;
      let meaningIdx = -1;
      let audioIdx = -1;

      for (let i = 0; i < fieldNames.length; i++) {
        const name = fieldNames[i].toLowerCase();
        if (name.includes("kanji") || name.includes("expression") || name.includes("japanese") || name.includes("vocab") || name === "word") {
          if (japaneseIdx === -1) japaneseIdx = i;
        }
        if (name.includes("kana") || name.includes("reading") || name.includes("yomi") || name.includes("hiragana") || name.includes("furigana")) {
          if (readingIdx === -1) readingIdx = i;
        }
        if (name.includes("english") || name.includes("meaning") || name.includes("translation") || name.includes("def") || name.includes("glossary")) {
          if (meaningIdx === -1) meaningIdx = i;
        }
        if (name.includes("audio") || name.includes("sound") || name.includes("voice") || name.includes("pronunciation")) {
          if (audioIdx === -1) audioIdx = i;
        }
      }

      for (let i = 0; i < fieldNames.length; i++) {
        let hasKanji = false;
        let hasKana = false;
        let hasEnglish = false;
        let hasAudioRef = false;

        let validSamples = 0;

        for (const sample of samples) {
          const val = sample[i] || "";
          if (!val) continue;
          validSamples++;

          if (/\x5bsound:[^\x5d]+\x5d/i.test(val)) hasAudioRef = true;
          if (/[\u4e00-\u9faf]/.test(val)) hasKanji = true;
          if (/[\u3040-\u309f\u30a0-\u30ff]/.test(val)) hasKana = true;
          if (/[a-zA-Z]/.test(val)) hasEnglish = true;
        }

        if (validSamples > 0) {
          if (audioIdx === -1 && hasAudioRef) audioIdx = i;
          if (japaneseIdx === -1 && hasKanji) japaneseIdx = i;
          if (readingIdx === -1 && hasKana && !hasKanji) readingIdx = i;
          if (meaningIdx === -1 && hasEnglish && !hasKanji && !hasKana) meaningIdx = i;
        }
      }

      // isJapaneseDeck is only true when evidence was found from field names or
      // sample content — not from the always-applied fallback of index 0.
      const isJapaneseDeck = japaneseIdx >= 0;
      if (japaneseIdx === -1) japaneseIdx = 0;
      if (meaningIdx === -1 && fieldNames.length > 1) {
        meaningIdx = 1;
      }

      const mapping: FieldMapping = { japaneseIdx, readingIdx, meaningIdx, audioIdx, isJapaneseDeck };
      modelFieldMap.set(midStr, mapping);
      insertCorrection.run(sourceId, midStr, JSON.stringify(mapping));
    }
  })();

  const cardOrdsByNid = new Map<number, number[]>();
  try {
    const cardsStmt = sqlDb.prepare("SELECT nid, ord FROM cards");
    while (cardsStmt.step()) {
      const [nid, ord] = cardsStmt.get() as [number, number];
      const list = cardOrdsByNid.get(nid) ?? [];
      list.push(ord);
      cardOrdsByNid.set(nid, list);
    }
    cardsStmt.free();
  } catch (e) {
    console.error("Error reading cards table:", e);
  }

  let imported = 0;
  const CHUNK_SIZE = 500;

  // Pre-analysis phase: runs async, outside any DB transaction.
  // Only processes rows whose model was positively identified as a Japanese deck.
  // The Anki deck's reading field is intentionally NOT passed to vocabNote — it is
  // not treated as ground truth. The kuromoji confidence pipeline runs independently
  // on the term, so uncertain readings are gated the same way textbook imports are.
  async function analyzeJapaneseRows(chunk: any[]): Promise<Map<number, NoteSpec>> {
    const results = new Map<number, NoteSpec>();
    for (const row of chunk) {
      const [nid, mid, flds] = row as [number, number, string];
      const mapping = modelFieldMap.get(String(mid));
      if (!mapping?.isJapaneseDeck) continue;
      const parts = flds.split("\x1f");
      const term = stripTags(parts[mapping.japaneseIdx] ?? "");
      if (!term) continue;
      const gloss = mapping.meaningIdx >= 0 ? stripTags(parts[mapping.meaningIdx] ?? "") : "";
      try {
        const spec = await vocabNote({ term, gloss });
        results.set(nid, spec);
      } catch {
        // Analysis failure: this row falls back to basic card in persistChunk
      }
    }
    return results;
  }

  // Persist phase: synchronous DB transaction using pre-computed analysis.
  const persistChunk = db.transaction(
    (chunk: any[], preAnalyzed: Map<number, NoteSpec>) => {
      let chunkImported = 0;
      for (const row of chunk) {
        const [nid, mid, flds, tags] = row as [number, number, string, string];
        const parts = flds.split("\x1f");
        const front = parts[0] ?? "";
        const back = parts[1] ?? "";

        const frontMedia = extractMediaRefs(front);
        const backMedia = extractMediaRefs(back);

        const images = [...frontMedia.images, ...backMedia.images].map(
          (orig) => origNameToStored[orig] ?? orig
        );
        const audio = [...frontMedia.audio, ...backMedia.audio].map(
          (orig) => origNameToStored[orig] ?? orig
        );

        const mapping = modelFieldMap.get(String(mid));
        if (mapping && mapping.audioIdx >= 0) {
          const audioRefs = extractMediaRefs(parts[mapping.audioIdx] ?? "");
          const specificAudio = audioRefs.audio.map((orig) => origNameToStored[orig] ?? orig);
          audio.unshift(...specificAudio); // Prepend so it becomes audio[0]
        }

        const spec = preAnalyzed.get(nid);
        if (spec) {
          // Japanese deck path: use the vocabNote spec for fields, analysis, and cards.
          const term = mapping && mapping.japaneseIdx >= 0 ? stripTags(parts[mapping.japaneseIdx] ?? "") : stripTags(front);
          const gloss = mapping && mapping.meaningIdx >= 0 ? stripTags(parts[mapping.meaningIdx] ?? "") : stripTags(back);

          const noteFields = {
            Front: stripTags(front),
            Back: stripTags(back),
            FrontHtml: front,
            BackHtml: back,
            japanese: term,
            ...(gloss && { meaning: gloss }),
            // Term/Reading/Gloss from vocabNote enable createNewlyEnabledCards later
            ...spec.fields,
          };

          const noteRes = insertNote.run(
            deckId, sourceId,
            JSON.stringify({ ankiNoteId: nid }),
            JSON.stringify(noteFields),
            spec.tags
          );
          const noteId = Number(noteRes.lastInsertRowid);

          for (const a of spec.analysis ?? []) {
            insertAnalysis.run(
              noteId, a.kind, a.surface, a.label,
              a.spanStart, a.spanEnd, a.confidence, a.band,
              a.needsReview ? 1 : 0,
              a.analyzerName, a.analyzerVersion,
              JSON.stringify(a.evidence),
              JSON.stringify(a.alternatives),
              JSON.stringify(a.payload)
            );
          }

          const media = { image: images[0], audio: audio[0] };
          for (const card of spec.cards) {
            const d = newCardDefaults();
            insertCard.run(
              noteId, deckId, card.cardType,
              JSON.stringify(card.question),
              JSON.stringify(card.answer),
              JSON.stringify({ ...media, ...(card.media ?? {}) }),
              d.due, d.stability, d.difficulty, d.elapsed_days, d.scheduled_days,
              d.reps, d.lapses, d.state
            );
            chunkImported++;
          }
        } else {
          // Non-Japanese / analysis-fallback path: plain basic card, unchanged behavior.
          const fields: any = { Front: stripTags(front), Back: stripTags(back), FrontHtml: front, BackHtml: back };
          if (mapping) {
            if (mapping.japaneseIdx >= 0) fields.japanese = stripTags(parts[mapping.japaneseIdx] ?? "");
            if (mapping.readingIdx >= 0) fields.reading = stripTags(parts[mapping.readingIdx] ?? "");
            if (mapping.meaningIdx >= 0) fields.meaning = stripTags(parts[mapping.meaningIdx] ?? "");
          }

          const noteRes = insertNote.run(
            deckId,
            sourceId,
            JSON.stringify({ ankiNoteId: nid }),
            JSON.stringify(fields),
            tags ?? ""
          );
          const noteId = Number(noteRes.lastInsertRowid);

          const ords = cardOrdsByNid.get(nid) ?? [0];
          for (const ord of ords) {
            const defaults = newCardDefaults();
            const media = {
              image: images[0],
              audio: audio[0],
            };
            insertCard.run(
              noteId,
              deckId,
              "basic",
              JSON.stringify({ text: fields.Front, ord }),
              JSON.stringify({ text: fields.Back }),
              JSON.stringify(media),
              defaults.due,
              defaults.stability,
              defaults.difficulty,
              defaults.elapsed_days,
              defaults.scheduled_days,
              defaults.reps,
              defaults.lapses,
              defaults.state
            );
            chunkImported++;
          }
        }
      }
      return chunkImported;
    }
  );

  try {
    const notesStmt = sqlDb.prepare("SELECT id, mid, flds, tags FROM notes");
    let chunk: any[] = [];
    while (notesStmt.step()) {
      chunk.push(notesStmt.get());
      if (chunk.length >= CHUNK_SIZE) {
        const preAnalyzed = await analyzeJapaneseRows(chunk);
        imported += persistChunk(chunk, preAnalyzed);
        chunk = [];
        // Yield to event loop
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    if (chunk.length > 0) {
      const preAnalyzed = await analyzeJapaneseRows(chunk);
      imported += persistChunk(chunk, preAnalyzed);
    }
    notesStmt.free();
  } finally {
    sqlDb.close();
  }

  return { deckId, cardsImported: imported };
}
