import AdmZip from "adm-zip";
import initSqlJs from "sql.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, MEDIA_DIR } from "../db/index.js";
import { newCardDefaults } from "./fsrs.js";
import { vocabNote, clozeSentenceNote, type NoteSpec } from "./cardgen.js";
import { tokenize } from "./jp/tokenizer.js";
import { readingRecords, type AnalysisRecord } from "./jp/analysisRecord.js";

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

// Strip Anki cloze deletion markers, keeping only the answer text.
// {{c1::answer::hint}} → answer  |  {{c1::answer}} → answer
function stripCloze(text: string): string {
  return text.replace(/\{\{c\d+::([^:}]+)(?:::[^}]*)?\}\}/g, "$1");
}

// Convert cloze text to a question form, replacing each deletion with a blank.
// {{c1::answer::hint}} → [hint]  |  {{c1::answer}} → [...]
function clozeToQuestion(text: string): string {
  return text.replace(
    /\{\{c\d+::(?:[^:}]+)(?:::([^}]*))?\}\}/g,
    (_: string, hint: string | undefined) => (hint ? `[${hint}]` : "[...]")
  );
}

// Parse every {{cN::answer}} / {{cN::answer::hint}} span out of a cloze field,
// keyed by its cN index — a single note can carry multiple distinct cN
// indices (e.g. {{c1::今日}}は{{c2::天気}}がいいですね generates 2 Anki cards,
// one per ord/cN). Anki's ord is 0-based and corresponds to cN-1.
function parseClozeSpans(text: string): Map<number, string> {
  const spans = new Map<number, string>();
  for (const m of text.matchAll(/\{\{c(\d+)::([^:}]+)(?:::[^}]*)?\}\}/g)) {
    const n = Number(m[1]);
    if (!spans.has(n)) spans.set(n, m[2]);
  }
  return spans;
}

// Return the index of the first Anki field referenced by an Anki template
// format string (qfmt / afmt).  {{FrontSide}} and conditional tags
// ({{#Field}}/{{^Field}}/{{/Field}}) are ignored.
function templatePrimaryFieldIndex(fmt: string, fieldNames: string[]): number {
  for (const m of fmt.matchAll(/\{\{([^#^/!{][^}]*?)\}\}/g)) {
    const name = m[1].trim();
    if (name === "FrontSide" || name.includes(":")) continue;
    const idx = fieldNames.indexOf(name);
    if (idx >= 0) return idx;
  }
  return -1;
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
  if (!collEntry) {
    if (entries.some((e) => e.entryName === "collection.anki21b")) {
      throw new Error(
        "This .apkg uses the zstd-compressed format (collection.anki21b) exported by Anki 2.1.50+. " +
        "Re-export from Anki using File → Export → 'Anki 2.1 deck (.apkg)' with 'Support older Anki versions' checked, " +
        "or import via the desktop Anki app and re-export as a legacy-compatible package."
      );
    }
    throw new Error("Not a valid .apkg file (no collection db found)");
  }

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

  // Read col: models + decks.  The decks column may be absent in minimal test
  // fixtures or very old anki2 exports, so fall back gracefully.
  let modelsJson = "{}";
  let ankiDecks: Record<string, any> = {};
  try {
    const colStmt = sqlDb.prepare("SELECT models, decks FROM col");
    colStmt.step();
    const row = colStmt.get() as [string, string | null];
    modelsJson = row[0] ?? "{}";
    if (row[1]) {
      try { ankiDecks = JSON.parse(row[1]); } catch {}
    }
    colStmt.free();
  } catch {
    // Fall back to models-only (older schema / minimal fixture)
    try {
      const colStmt = sqlDb.prepare("SELECT models FROM col");
      colStmt.step();
      modelsJson = (colStmt.get() as [string])[0] ?? "{}";
      colStmt.free();
    } catch {}
  }

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

  // Create the source row first; it's needed by insertCorrection below.
  const sourceId = db.transaction(() =>
    Number(insertSource.run(originalFilename, fileHash).lastInsertRowid)
  )();

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

  // Build per-model: (a) cloze flag (type===1), (b) template-based q/a field indices.
  // These are in-memory only — no DB writes needed.
  const modelClozeSet = new Set<string>();
  type TemplateQA = { qIdx: number; aIdx: number };
  const modelTemplates = new Map<string, TemplateQA[]>();
  for (const [midStr, model] of Object.entries(models)) {
    if (model.type === 1) modelClozeSet.add(midStr);
    if (model.tmpls && model.flds) {
      const fieldNames: string[] = model.flds.map((f: any) => f.name as string);
      const tmpls: TemplateQA[] = (model.tmpls as any[]).map((tmpl) => ({
        qIdx: templatePrimaryFieldIndex(tmpl.qfmt ?? "", fieldNames),
        aIdx: templatePrimaryFieldIndex(tmpl.afmt ?? "", fieldNames),
      }));
      modelTemplates.set(midStr, tmpls);
    }
  }

  // Read cards: track ord lists per note and (when the did column exists) the
  // Anki deck id for each note's first card.  The did column is absent in
  // minimal test fixtures and very old anki2 exports, so fall back gracefully.
  const cardOrdsByNid = new Map<number, number[]>();
  const noteAnkiDid = new Map<number, number>(); // nid → Anki deck id
  {
    let stmt: ReturnType<typeof sqlDb.prepare> | null = null;
    let hasDid = true;
    try {
      stmt = sqlDb.prepare("SELECT nid, ord, did FROM cards");
    } catch {
      hasDid = false;
      try { stmt = sqlDb.prepare("SELECT nid, ord FROM cards"); } catch (e) {
        console.error("Error preparing cards query:", e);
      }
    }
    if (stmt) {
      try {
        while (stmt.step()) {
          const row = stmt.get() as number[];
          const nid = row[0];
          const ord = row[1];
          const did = hasDid ? row[2] : 1;
          const list = cardOrdsByNid.get(nid) ?? [];
          list.push(ord);
          cardOrdsByNid.set(nid, list);
          if (!noteAnkiDid.has(nid)) noteAnkiDid.set(nid, did);
        }
      } catch (e) {
        console.error("Error reading cards table:", e);
      }
      stmt.free();
    }
  }

  // Create one app deck per unique Anki deck referenced by the cards table.
  // Anki sub-deck names use "::" as a separator; convert to " > " for display.
  // The deckName parameter acts as a fallback for the Anki "Default" deck or
  // when deck metadata is unavailable.
  const appDeckByAnkiDid = new Map<number, number>(); // ankiDid → app deckId
  db.transaction(() => {
    const uniqueDids = new Set(noteAnkiDid.values());
    for (const did of uniqueDids) {
      const ankiDeckInfo = ankiDecks[String(did)] as any | undefined;
      const rawName = ankiDeckInfo?.name as string | undefined;
      const displayName = rawName && rawName !== "Default"
        ? rawName.replace(/::/g, " > ")
        : deckName;
      appDeckByAnkiDid.set(did, Number(insertDeck.run(displayName).lastInsertRowid));
    }
    if (appDeckByAnkiDid.size === 0) {
      // No cards (orphaned notes only) — create a single fallback deck.
      appDeckByAnkiDid.set(-1, Number(insertDeck.run(deckName).lastInsertRowid));
    }
  })();

  // Stable fallback deck id: used for notes whose nid has no card row.
  const fallbackDeckId: number = appDeckByAnkiDid.values().next().value!;

  let imported = 0;
  const CHUNK_SIZE = 500;

  // Pre-analysis phase: runs async, outside any DB transaction.
  // Only processes rows whose model was positively identified as a Japanese deck.
  // The Anki deck's reading field is intentionally NOT passed to vocabNote — it is
  // not treated as ground truth. The kuromoji confidence pipeline runs independently
  // on the term, so uncertain readings are gated the same way textbook imports are.
  //
  // Routing is template-count-aware, not just content-aware: a note's generated
  // card count/direction must track its source template count.
  //  - Exactly one template (the common dedicated-vocab-notetype case): route
  //    through vocabNote() for the full enriched card bundle.
  //  - More than one template (reversed-card, custom multi-card notetypes): the
  //    deck author's template structure is deliberate. Don't replace it with an
  //    unrelated bundle — keep the existing template-based basic-card path (so
  //    card count/direction matches the source) and instead attach analysis-only
  //    records (note_analyses rows) for the Japanese content found, so the
  //    analysis/provenance panel isn't empty.
  async function analyzeJapaneseRows(
    chunk: any[]
  ): Promise<{ specs: Map<number, NoteSpec>; analysisOnly: Map<number, AnalysisRecord[]> }> {
    const specs = new Map<number, NoteSpec>();
    const analysisOnly = new Map<number, AnalysisRecord[]>();
    for (const row of chunk) {
      const [nid, mid, flds] = row as [number, number, string];
      const mapping = modelFieldMap.get(String(mid));
      // Skip cloze notes in the Japanese analysis path — extract the cloze
      // answer before deciding whether it warrants vocabNote analysis.
      if (!mapping?.isJapaneseDeck || modelClozeSet.has(String(mid))) continue;
      const parts = flds.split("\x1f");
      const term = stripTags(parts[mapping.japaneseIdx] ?? "");
      if (!term) continue;
      const gloss = mapping.meaningIdx >= 0 ? stripTags(parts[mapping.meaningIdx] ?? "") : "";

      const templateCount = (modelTemplates.get(String(mid)) ?? []).length;
      const isMultiTemplate = templateCount > 1;

      if (!isMultiTemplate) {
        try {
          const spec = await vocabNote({ term, gloss });
          specs.set(nid, spec);
        } catch {
          // Analysis failure: this row falls back to basic card in persistChunk
        }
        continue;
      }

      // Multi-template note: respect the source's per-ord template structure
      // (handled by persistChunk's non-Japanese branch) but still surface
      // Japanese-content provenance by analyzing the resolved term text.
      try {
        const tokens = await tokenize(term);
        const records = readingRecords(tokens);
        if (records.length) analysisOnly.set(nid, records);
      } catch {
        // Analysis failure: note still gets its template-based basic cards,
        // just without note_analyses rows.
      }
    }
    return { specs, analysisOnly };
  }

  // Pre-analysis phase for Japanese-content Cloze notes: one NoteSpec per
  // (nid, cN) pair, reusing the same sentence-level tokenize/furigana path
  // the textbook pipeline uses for cloze cards (cardgen.ts clozeSentenceNote).
  // Anki's ord is 0-based and corresponds to cN-1, so ord 0 → {{c1::...}},
  // ord 1 → {{c2::...}}, etc.  A null entry means the target span couldn't be
  // matched against tokenization — caller falls back to the plain-text cloze
  // behavior for that ord rather than asserting an unverified reading.
  async function analyzeJapaneseClozeRows(
    chunk: any[]
  ): Promise<Map<number, Map<number, NoteSpec | null>>> {
    const results = new Map<number, Map<number, NoteSpec | null>>();
    for (const row of chunk) {
      const [nid, mid, flds] = row as [number, number, string];
      const mapping = modelFieldMap.get(String(mid));
      if (!mapping?.isJapaneseDeck || !modelClozeSet.has(String(mid))) continue;
      const parts = flds.split("\x1f");
      const rawText = stripTags(parts[0] ?? "");
      if (!rawText) continue;
      const spans = parseClozeSpans(rawText);
      if (spans.size === 0) continue;
      const fullSentence = stripCloze(rawText);

      const perOrd = new Map<number, NoteSpec | null>();
      for (const [n, target] of spans) {
        const ord = n - 1;
        try {
          perOrd.set(ord, await clozeSentenceNote(fullSentence, target));
        } catch {
          perOrd.set(ord, null);
        }
      }
      results.set(nid, perOrd);
    }
    return results;
  }

  // Persist phase: synchronous DB transaction using pre-computed analysis.
  const persistChunk = db.transaction(
    (
      chunk: any[],
      preAnalyzed: Map<number, NoteSpec>,
      analysisOnly: Map<number, AnalysisRecord[]>,
      preAnalyzedCloze: Map<number, Map<number, NoteSpec | null>>
    ) => {
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

        // Resolve the app deck for this note (based on its first card's Anki did).
        const noteDeckId = appDeckByAnkiDid.get(noteAnkiDid.get(nid) ?? -1) ?? fallbackDeckId;

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
            noteDeckId, sourceId,
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
              noteId, noteDeckId, card.cardType,
              JSON.stringify(card.question),
              JSON.stringify(card.answer),
              JSON.stringify({ ...media, ...(card.media ?? {}) }),
              d.due, d.stability, d.difficulty, d.elapsed_days, d.scheduled_days,
              d.reps, d.lapses, d.state
            );
            chunkImported++;
          }
        } else {
          // Non-Japanese / analysis-fallback path.
          //
          // Question/answer field selection priority:
          //  1. Template-based: parse the model's qfmt/afmt for this card's ord to
          //     find which field drives the question and which drives the answer.
          //     This correctly handles reversed-card models (ord 1 swaps front/back)
          //     and any other multi-template model.
          //  2. Field-mapping inference: use the japaneseIdx/meaningIdx inferred
          //     from field names + sample content.
          //  3. Default fallback: parts[0] (front) / parts[1] (back).
          //
          // Cloze models (type===1) are handled separately: {{c1::answer}} markup
          // is converted to a blank-form question and an answer with fills resolved.

          const isCloze = modelClozeSet.has(String(mid));
          const templates = modelTemplates.get(String(mid));
          // Per-ord Japanese cloze NoteSpecs (null = couldn't tokenize cleanly,
          // falls back to plain cloze behavior for that ord).
          const jpClozeSpecs = isCloze ? preAnalyzedCloze.get(nid) : undefined;

          const fields: any = {
            Front: stripTags(isCloze ? stripCloze(front) : front),
            Back: stripTags(back),
            FrontHtml: front,
            BackHtml: back,
          };
          if (mapping) {
            if (mapping.japaneseIdx >= 0) fields.japanese = stripTags(parts[mapping.japaneseIdx] ?? "");
            if (mapping.readingIdx >= 0) fields.reading = stripTags(parts[mapping.readingIdx] ?? "");
            if (mapping.meaningIdx >= 0) fields.meaning = stripTags(parts[mapping.meaningIdx] ?? "");
          }

          // When any ord of a Japanese cloze note resolved to a confident
          // NoteSpec, tag the note consistently with the textbook cloze path.
          let noteTags = tags ?? "";
          if (jpClozeSpecs) {
            const anySpec = [...jpClozeSpecs.values()].find((s): s is NoteSpec => s !== null);
            if (anySpec) noteTags = noteTags ? `${noteTags} ${anySpec.tags}` : anySpec.tags;
          }

          const noteRes = insertNote.run(
            noteDeckId,
            sourceId,
            JSON.stringify({ ankiNoteId: nid }),
            JSON.stringify(fields),
            noteTags
          );
          const noteId = Number(noteRes.lastInsertRowid);

          // Multi-template Japanese notes don't get the vocabNote() card bundle
          // (that would override the deck author's template structure), but the
          // analysis pipeline still ran against the resolved term — persist its
          // note_analyses rows so the analysis/provenance panel isn't empty.
          const records = analysisOnly.get(nid);
          if (records) {
            for (const a of records) {
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
          }

          // note_analyses provenance for Japanese cloze notes: written once per
          // note (not once per ord) — every ord re-tokenizes the same underlying
          // sentence, so the analysis records are identical across ords and
          // would otherwise be duplicated.
          if (jpClozeSpecs) {
            const firstSpec = [...jpClozeSpecs.values()].find((s): s is NoteSpec => s !== null);
            for (const a of firstSpec?.analysis ?? []) {
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
          }

          const ords = cardOrdsByNid.get(nid) ?? [0];
          for (const ord of ords) {
            const defaults = newCardDefaults();
            const media = { image: images[0], audio: audio[0] };

            const jpSpec = jpClozeSpecs?.get(ord);
            if (jpSpec) {
              // Japanese-content cloze note: sentence-level furigana/reading
              // gated cloze card, matching the textbook cloze shape exactly.
              const card = jpSpec.cards[0];
              insertCard.run(
                noteId,
                noteDeckId,
                card.cardType,
                JSON.stringify(card.question),
                JSON.stringify(card.answer),
                JSON.stringify({ ...media, ...(card.media ?? {}) }),
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
              continue;
            }

            let questionText: string;
            let answerText: string;

            if (isCloze) {
              // Show blanked sentence as question; full resolved text as answer.
              const rawText = stripTags(parts[0] ?? "");
              questionText = clozeToQuestion(rawText);
              answerText = stripCloze(rawText);
            } else if (templates && templates[ord] && templates[ord].qIdx >= 0) {
              // Template-based field selection (handles reversed-card models, etc.)
              const tmpl = templates[ord];
              questionText = stripTags(parts[tmpl.qIdx] ?? "");
              answerText = tmpl.aIdx >= 0 ? stripTags(parts[tmpl.aIdx] ?? "") : fields.Back;
            } else if (mapping?.isJapaneseDeck) {
              // Field-mapping inference (e.g. a 6-field notetype where kanji/meaning
              // aren't at indices 0/1)
              questionText = stripTags(parts[mapping.japaneseIdx] ?? "");
              answerText = mapping.meaningIdx >= 0 && mapping.meaningIdx !== mapping.japaneseIdx
                ? stripTags(parts[mapping.meaningIdx] ?? "")
                : fields.Back;
            } else {
              // Default: first two fields
              questionText = fields.Front;
              answerText = fields.Back;
            }

            insertCard.run(
              noteId,
              noteDeckId,
              "basic",
              JSON.stringify({ text: questionText, ord }),
              JSON.stringify({ text: answerText }),
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
        const { specs, analysisOnly } = await analyzeJapaneseRows(chunk);
        const preAnalyzedCloze = await analyzeJapaneseClozeRows(chunk);
        imported += persistChunk(chunk, specs, analysisOnly, preAnalyzedCloze);
        chunk = [];
        // Yield to event loop
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    if (chunk.length > 0) {
      const { specs, analysisOnly } = await analyzeJapaneseRows(chunk);
      const preAnalyzedCloze = await analyzeJapaneseClozeRows(chunk);
      imported += persistChunk(chunk, specs, analysisOnly, preAnalyzedCloze);
    }
    notesStmt.free();
  } finally {
    sqlDb.close();
  }

  const deckIds = [...new Set(appDeckByAnkiDid.values())];
  return { deckId: deckIds[0] ?? -1, deckIds, cardsImported: imported };
}
