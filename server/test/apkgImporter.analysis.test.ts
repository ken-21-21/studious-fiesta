/**
 * Tests for the apkg → Japanese analysis/cardgen pipeline wiring.
 *
 * Three cases mirror the problem statement:
 *  1. Japanese vocab deck (kanji+kana field names, clear evidence) →
 *       note_analyses row written, vocab card generated, reading-dependent
 *       cards (listening/pitch) produced only when the reading clears the
 *       confidence gate.
 *  2. English-only deck (no Japanese field evidence) →
 *       unchanged existing behavior: single basic card, no note_analyses row.
 *  3. Deck containing a genuinely ambiguous term ("生物") →
 *       note is tagged needs_review, reading-dependent cards are NOT generated
 *       (the "never silently teach wrong Japanese" invariant is upheld).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import initSqlJs from "sql.js";
import { importApkg } from "../src/lib/apkgImporter.js";
import { db } from "../src/db/index.js";

// ---------------------------------------------------------------------------
// Helper: build a minimal .apkg zip from a sql.js database definition.
// ---------------------------------------------------------------------------

interface ApkgSpec {
  models: Record<string, { fields: string[] }>;
  notes: { id: number; mid: number; flds: string; tags: string }[];
  cards: { id: number; nid: number; ord: number }[];
}

async function buildApkg(spec: ApkgSpec): Promise<string> {
  const SQL = await initSqlJs();
  const sqlDb = new SQL.Database();

  const modelsJson = JSON.stringify(
    Object.fromEntries(
      Object.entries(spec.models).map(([mid, m]) => [
        mid,
        { flds: m.fields.map((name) => ({ name })) },
      ])
    )
  );

  sqlDb.run(`
    CREATE TABLE col (id INTEGER PRIMARY KEY, models TEXT);
    CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT, tags TEXT);
    CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, ord INTEGER);
  `);
  sqlDb.run("INSERT INTO col (id, models) VALUES (1, ?)", [modelsJson]);
  for (const note of spec.notes) {
    sqlDb.run("INSERT INTO notes (id, mid, flds, tags) VALUES (?, ?, ?, ?)", [
      note.id,
      note.mid,
      note.flds,
      note.tags,
    ]);
  }
  for (const card of spec.cards) {
    sqlDb.run("INSERT INTO cards (id, nid, ord) VALUES (?, ?, ?)", [
      card.id,
      card.nid,
      card.ord,
    ]);
  }

  const data = Buffer.from(sqlDb.export());
  sqlDb.close();

  const zip = new AdmZip();
  zip.addFile("collection.anki21", data);
  zip.addFile("media", Buffer.from("{}"));

  const tmp = path.join(
    os.tmpdir(),
    `apkg-analysis-${Date.now()}-${Math.random().toString(36).slice(2)}.apkg`
  );
  fs.writeFileSync(tmp, zip.toBuffer());
  return tmp;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("apkg → Japanese analysis/cardgen pipeline", () => {
  it("Japanese vocab deck: writes note_analyses and generates vocab card", async () => {
    // "学校" (がっこう, school) — unambiguous, kuromoji should be confident.
    const tmp = await buildApkg({
      models: {
        "1001": { fields: ["Kanji", "Kana", "English"] },
      },
      notes: [
        { id: 1, mid: 1001, flds: "学校\x1fがっこう\x1fschool", tags: "" },
      ],
      cards: [{ id: 1, nid: 1, ord: 0 }],
    });

    try {
      const result = await importApkg(tmp, "JP Vocab Deck");

      // At minimum, one card should have been imported.
      expect(result.cardsImported).toBeGreaterThanOrEqual(1);

      // A note_analyses row must exist for the imported note.
      const analyses = db
        .prepare(
          "SELECT * FROM note_analyses WHERE note_id IN (SELECT id FROM notes WHERE deck_id = ?)"
        )
        .all(result.deckId) as any[];
      expect(analyses.length).toBeGreaterThan(0);

      // At least one vocab card must be present.
      const cards = db
        .prepare("SELECT card_type FROM cards WHERE deck_id = ?")
        .all(result.deckId) as { card_type: string }[];
      const types = cards.map((c) => c.card_type);
      expect(types).toContain("vocab");

      // The note should carry the "vocabulary" tag.
      const notes = db
        .prepare("SELECT tags FROM notes WHERE deck_id = ?")
        .all(result.deckId) as { tags: string }[];
      expect(notes.every((n) => n.tags.includes("vocabulary"))).toBe(true);
    } finally {
      fs.unlink(tmp, () => {});
    }
  });

  it("confident reading: reading-dependent cards (listening) are generated", async () => {
    // "先生" (せんせい, teacher) — unambiguous everyday word, kuromoji reads it confidently.
    // With a confident reading the pipeline should also generate a listening card.
    const tmp = await buildApkg({
      models: {
        "1002": { fields: ["Expression", "Reading", "Meaning"] },
      },
      notes: [
        { id: 10, mid: 1002, flds: "先生\x1fせんせい\x1fteacher", tags: "" },
      ],
      cards: [{ id: 10, nid: 10, ord: 0 }],
    });

    try {
      const result = await importApkg(tmp, "JP Confident Deck");
      const cards = db
        .prepare("SELECT card_type FROM cards WHERE deck_id = ?")
        .all(result.deckId) as { card_type: string }[];
      const types = new Set(cards.map((c) => c.card_type));

      // vocab card always produced; listening card produced when reading is confident
      expect(types.has("vocab")).toBe(true);
      expect(types.has("listening")).toBe(true);
    } finally {
      fs.unlink(tmp, () => {});
    }
  });

  it("English-only deck: single basic card, no note_analyses row", async () => {
    // "Front"/"Back" field names with plain English content — no Japanese evidence.
    const tmp = await buildApkg({
      models: {
        "2001": { fields: ["Front", "Back"] },
      },
      notes: [{ id: 2, mid: 2001, flds: "hello\x1fworld", tags: "" }],
      cards: [{ id: 2, nid: 2, ord: 0 }],
    });

    try {
      const result = await importApkg(tmp, "EN Only Deck");

      // Exactly one basic card — unchanged behavior.
      expect(result.cardsImported).toBe(1);

      const cards = db
        .prepare("SELECT card_type FROM cards WHERE deck_id = ?")
        .all(result.deckId) as { card_type: string }[];
      expect(cards.length).toBe(1);
      expect(cards[0].card_type).toBe("basic");

      // No analysis rows.
      const analyses = db
        .prepare(
          "SELECT id FROM note_analyses WHERE note_id IN (SELECT id FROM notes WHERE deck_id = ?)"
        )
        .all(result.deckId) as any[];
      expect(analyses.length).toBe(0);
    } finally {
      fs.unlink(tmp, () => {});
    }
  });

  it("ambiguous reading: note tagged needs_review, reading-dependent cards withheld", async () => {
    // "生物" (せいぶつ / なまもの) — a genuinely ambiguous homograph; the readings
    // test confirms kuromoji marks it needsReview.  The pipeline must NOT generate
    // listening or pitch cards for uncertain readings (core invariant).
    const tmp = await buildApkg({
      models: {
        "3001": { fields: ["Kanji", "Kana", "English"] },
      },
      notes: [
        {
          id: 3,
          mid: 3001,
          flds: "生物\x1f\x1fbiology or raw food",
          tags: "",
        },
      ],
      cards: [{ id: 3, nid: 3, ord: 0 }],
    });

    try {
      const result = await importApkg(tmp, "Ambiguous Deck");

      // Should have imported at least one card.
      expect(result.cardsImported).toBeGreaterThanOrEqual(1);

      // Analysis row must exist (the analyzer ran and produced a record).
      const analyses = db
        .prepare(
          "SELECT needs_review FROM note_analyses WHERE note_id IN (SELECT id FROM notes WHERE deck_id = ?)"
        )
        .all(result.deckId) as { needs_review: number }[];
      expect(analyses.length).toBeGreaterThan(0);
      // At least one analysis record must be flagged needs_review.
      expect(analyses.some((a) => a.needs_review === 1)).toBe(true);

      // The note must be tagged needs_review.
      const notes = db
        .prepare("SELECT tags FROM notes WHERE deck_id = ?")
        .all(result.deckId) as { tags: string }[];
      expect(notes.every((n) => n.tags.includes("needs_review"))).toBe(true);

      // Reading-dependent cards (listening, pitch) must NOT be generated.
      const cards = db
        .prepare("SELECT card_type FROM cards WHERE deck_id = ?")
        .all(result.deckId) as { card_type: string }[];
      const types = new Set(cards.map((c) => c.card_type));
      expect(types.has("listening")).toBe(false);
      expect(types.has("pitch")).toBe(false);

      // The safe "vocab" meaning card (JP→EN direction) must be present.
      expect(types.has("vocab")).toBe(true);
    } finally {
      fs.unlink(tmp, () => {});
    }
  });
});
