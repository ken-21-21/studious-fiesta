import AdmZip from "adm-zip";
import initSqlJs from "sql.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, MEDIA_DIR } from "../db/index.js";
import { newCardDefaults } from "./fsrs.js";

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
    fs.writeFileSync(path.join(MEDIA_DIR, safeName), entry.getData());
    origNameToStored[originalName] = safeName;
  }

  const sqljs = await getSql();
  let sqlDb: InstanceType<typeof sqljs.Database>;
  try {
    sqlDb = new sqljs.Database(collEntry.getData());
  } catch {
    throw new Error("Not a valid .apkg file (collection database is corrupt)");
  }

  // notes: id, flds (fields separated by \x1f), tags
  let notesRes, cardsRes;
  try {
    notesRes = sqlDb.exec("SELECT id, flds, tags FROM notes");
    cardsRes = sqlDb.exec("SELECT nid, ord FROM cards");
  } finally {
    sqlDb.close();
  }

  if (!notesRes.length) {
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

  const fileHash = await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.pipe(hash).on("finish", () => {
      resolve(hash.digest("hex"));
    });
  });

  const importAll = db.transaction(() => {
    const sourceId = Number(insertSource.run(originalFilename, fileHash).lastInsertRowid);
    const deckRow = insertDeck.run(deckName);
    const deckId = Number(deckRow.lastInsertRowid);

    const cardOrdsByNid = new Map<number, number[]>();
    if (cardsRes.length) {
      for (const row of cardsRes[0].values) {
        const [nid, ord] = row as [number, number];
        const list = cardOrdsByNid.get(nid) ?? [];
        list.push(ord);
        cardOrdsByNid.set(nid, list);
      }
    }

    let imported = 0;
    for (const row of notesRes[0].values) {
      const [nid, flds, tags] = row as [number, string, string];
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

      const fields = { Front: stripTags(front), Back: stripTags(back), FrontHtml: front, BackHtml: back };
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
        imported++;
      }
    }

    return { deckId, imported };
  });

  const { deckId, imported } = importAll();
  return { deckId, cardsImported: imported };
}
