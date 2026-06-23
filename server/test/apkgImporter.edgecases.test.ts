/**
 * Stress-test / edge-case regression tests for apkgImporter.
 *
 * Covers issues found by reading the code and constructing minimal
 * but structurally realistic .apkg files:
 *
 *  A1  Cloze notetype — {{c1::...}} markup stripped, not passed through raw
 *  A2  Multi-template reversed card — ord=1 uses Back→Front, not Front→Back
 *  A3  collection.anki21b — clear unsupported-format error, not "corrupt"
 *  A4  Multi-deck apkg — separate app deck per Anki deck
 *  A5  Template-based field mapping — qfmt/afmt respected when fields aren't 0/1
 *  A6  Orphaned notes (no cards row) — note still imported with a basic card
 *  A7  HTML-heavy fields — all tags stripped, no raw HTML in card question/answer
 *  A8  Japanese content in a multi-template (reversed-card) notetype — card
 *      count/direction tracks the source's 2 templates, not an unrelated
 *      vocab/production/listening/pitch bundle; Japanese content still gets
 *      note_analyses rows for provenance.
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
// Helper: build a minimal .apkg zip with the full Anki schema.
// ---------------------------------------------------------------------------

interface ApkgSpec {
  models: Record<string, {
    fields: string[];
    type?: number;  // 0 = Standard (default), 1 = Cloze
    tmpls?: Array<{ name: string; qfmt: string; afmt: string }>;
  }>;
  /** Anki deck id → deck display info (written into col.decks JSON) */
  decks?: Record<string, { name: string }>;
  notes: Array<{ id: number; mid: number; flds: string; tags: string }>;
  /** did defaults to 1 (Anki "Default" deck) when omitted */
  cards: Array<{ id: number; nid: number; ord: number; did?: number }>;
}

async function buildApkg(spec: ApkgSpec): Promise<string> {
  const SQL = await initSqlJs();
  const sqlDb = new SQL.Database();

  const modelsJson = JSON.stringify(
    Object.fromEntries(
      Object.entries(spec.models).map(([mid, m]) => [
        mid,
        {
          flds: m.fields.map((name, ord) => ({ name, ord })),
          type: m.type ?? 0,
          ...(m.tmpls
            ? { tmpls: m.tmpls.map((t, ord) => ({ ...t, ord })) }
            : {}),
        },
      ])
    )
  );

  const decksJson = JSON.stringify(
    spec.decks
      ? Object.fromEntries(
          Object.entries(spec.decks).map(([did, d]) => [
            did,
            { id: Number(did), name: d.name },
          ])
        )
      : {}
  );

  sqlDb.run(`
    CREATE TABLE col  (id INTEGER PRIMARY KEY, models TEXT, decks TEXT);
    CREATE TABLE notes(id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT, tags TEXT);
    CREATE TABLE cards(id INTEGER PRIMARY KEY, nid INTEGER, ord INTEGER, did INTEGER);
  `);
  sqlDb.run("INSERT INTO col (id, models, decks) VALUES (1, ?, ?)", [modelsJson, decksJson]);
  for (const note of spec.notes) {
    sqlDb.run("INSERT INTO notes (id, mid, flds, tags) VALUES (?, ?, ?, ?)", [
      note.id, note.mid, note.flds, note.tags,
    ]);
  }
  for (const card of spec.cards) {
    sqlDb.run("INSERT INTO cards (id, nid, ord, did) VALUES (?, ?, ?, ?)", [
      card.id, card.nid, card.ord, card.did ?? 1,
    ]);
  }

  const data = Buffer.from(sqlDb.export());
  sqlDb.close();

  const zip = new AdmZip();
  zip.addFile("collection.anki21", data);
  zip.addFile("media", Buffer.from("{}"));

  const tmp = path.join(
    os.tmpdir(),
    `apkg-ec-${Date.now()}-${Math.random().toString(36).slice(2)}.apkg`
  );
  fs.writeFileSync(tmp, zip.toBuffer());
  return tmp;
}

// ---------------------------------------------------------------------------
// A1 — Cloze notetype
// ---------------------------------------------------------------------------

describe("A1 — Cloze notetype", () => {
  it("strips {{c1::answer}} from card question and resolves it in the answer", async () => {
    const tmp = await buildApkg({
      models: {
        "9001": {
          fields: ["Text", "Back Extra"],
          type: 1, // Cloze
        },
      },
      notes: [
        {
          id: 1,
          mid: 9001,
          // Cloze-style Text field + Back Extra
          flds: "今日は{{c1::天気}}がいいですね\x1fExtra info here",
          tags: "",
        },
      ],
      cards: [{ id: 1, nid: 1, ord: 0 }],
    });

    try {
      const result = await importApkg(tmp, "Cloze Deck");
      expect(result.cardsImported).toBeGreaterThanOrEqual(1);

      const cards = db
        .prepare("SELECT question, answer FROM cards WHERE deck_id = ?")
        .all(result.deckId) as { question: string; answer: string }[];

      expect(cards.length).toBeGreaterThanOrEqual(1);

      const q = JSON.parse(cards[0].question) as { text: string };
      const a = JSON.parse(cards[0].answer) as { text: string };

      // Raw cloze markup must NOT appear in either question or answer
      expect(q.text).not.toContain("{{c1::");
      expect(a.text).not.toContain("{{c1::");

      // Question should show a blank placeholder. Japanese-content cloze
      // notes are routed through the sentence-level furigana cloze path
      // (cardgen.ts clozeSentenceNote), which uses the same "＿＿＿" blank
      // marker as textbook cloze cards rather than the plain "[...]"
      // placeholder used for non-Japanese cloze notes.
      expect(q.text).toContain("＿＿＿");

      // Answer should contain the resolved fill-in ("天気")
      expect(a.text).toContain("天気");
    } finally {
      fs.unlink(tmp, () => {});
    }
  });

  it("strips hint form {{c1::answer::hint}} correctly", async () => {
    const tmp = await buildApkg({
      models: { "9002": { fields: ["Text"], type: 1 } },
      notes: [{ id: 2, mid: 9002, flds: "{{c1::東京::capital}}は日本の首都です", tags: "" }],
      cards: [{ id: 2, nid: 2, ord: 0 }],
    });
    try {
      const result = await importApkg(tmp, "Cloze Hint Deck");
      const cards = db
        .prepare("SELECT question, answer FROM cards WHERE deck_id = ?")
        .all(result.deckId) as { question: string; answer: string }[];

      const q = JSON.parse(cards[0].question) as { text: string };
      const a = JSON.parse(cards[0].answer) as { text: string };

      expect(q.text).not.toContain("{{c1::");
      // Japanese-content cloze notes use the sentence-level furigana cloze
      // path, which doesn't carry the Anki hint text through (it gates on
      // tokenized confidence instead) — the blank marker appears in its place.
      expect(q.text).toContain("＿＿＿");
      // answer should have the fill resolved
      expect(a.text).toContain("東京");
    } finally {
      fs.unlink(tmp, () => {});
    }
  });
});

// ---------------------------------------------------------------------------
// A2 — Multi-template reversed card
// ---------------------------------------------------------------------------

describe("A2 — Multi-template reversed card", () => {
  it("ord=0 uses Front→Back and ord=1 uses Back→Front", async () => {
    const tmp = await buildApkg({
      models: {
        "8001": {
          fields: ["Front", "Back"],
          type: 0,
          tmpls: [
            {
              name: "Card 1",
              qfmt: "{{Front}}",
              afmt: "{{FrontSide}}<hr id=answer>{{Back}}",
            },
            {
              name: "Card 2",
              qfmt: "{{Back}}",
              afmt: "{{FrontSide}}<hr id=answer>{{Front}}",
            },
          ],
        },
      },
      notes: [{ id: 1, mid: 8001, flds: "Front text\x1fBack text", tags: "" }],
      // Two cards for the same note: ord 0 and ord 1
      cards: [
        { id: 1, nid: 1, ord: 0 },
        { id: 2, nid: 1, ord: 1 },
      ],
    });

    try {
      const result = await importApkg(tmp, "Reversed Deck");
      expect(result.cardsImported).toBe(2);

      const cards = db
        .prepare("SELECT question, answer FROM cards WHERE deck_id = ?")
        .all(result.deckId) as { question: string; answer: string }[];

      expect(cards).toHaveLength(2);

      // Sort by ord embedded in the question JSON
      const sorted = cards
        .map((c) => ({
          q: JSON.parse(c.question) as { text: string; ord: number },
          a: JSON.parse(c.answer) as { text: string },
        }))
        .sort((x, y) => x.q.ord - y.q.ord);

      // ord=0: question = Front field, answer = Back field
      expect(sorted[0].q.text).toBe("Front text");
      expect(sorted[0].a.text).toBe("Back text");

      // ord=1: question = Back field, answer = Front field
      expect(sorted[1].q.text).toBe("Back text");
      expect(sorted[1].a.text).toBe("Front text");
    } finally {
      fs.unlink(tmp, () => {});
    }
  });
});

// ---------------------------------------------------------------------------
// A3 — collection.anki21b — clear error, not "corrupt"
// ---------------------------------------------------------------------------

describe("A3 — collection.anki21b unsupported format", () => {
  it("throws a clear error naming anki21b / zstd instead of 'corrupt'", async () => {
    const SQL = await initSqlJs();
    const sqlDb = new SQL.Database();
    sqlDb.run(
      "CREATE TABLE col(id INTEGER PRIMARY KEY, models TEXT); INSERT INTO col VALUES(1,'{}');"
    );
    const data = Buffer.from(sqlDb.export());
    sqlDb.close();

    const zip = new AdmZip();
    // Use the modern filename instead of collection.anki21
    zip.addFile("collection.anki21b", data);
    zip.addFile("media", Buffer.from("{}"));

    const tmp = path.join(os.tmpdir(), `anki21b-${Date.now()}.apkg`);
    fs.writeFileSync(tmp, zip.toBuffer());

    try {
      await expect(importApkg(tmp, "Modern Deck")).rejects.toThrow(
        /anki21b|zstd/i
      );
      // Error must NOT say "corrupt" — that's misleading for a valid modern format
      await expect(importApkg(tmp, "Modern Deck")).rejects.not.toThrow(
        /corrupt/i
      );
    } finally {
      fs.unlink(tmp, () => {});
    }
  });
});

// ---------------------------------------------------------------------------
// A4 — Multi-deck apkg
// ---------------------------------------------------------------------------

describe("A4 — Multi-deck apkg", () => {
  it("creates separate app decks for each Anki deck, cards land in the right deck", async () => {
    const tmp = await buildApkg({
      models: {
        "7001": { fields: ["Front", "Back"] },
      },
      decks: {
        "1001": { name: "Japanese" },
        "1002": { name: "English" },
      },
      notes: [
        { id: 1, mid: 7001, flds: "apple\x1fa red fruit", tags: "" },
        { id: 2, mid: 7001, flds: "goodbye\x1ffarewell", tags: "" },
      ],
      cards: [
        { id: 1, nid: 1, ord: 0, did: 1001 },
        { id: 2, nid: 2, ord: 0, did: 1002 },
      ],
    });

    try {
      const result = await importApkg(tmp, "Fallback Deck");

      // Two distinct app decks must have been created
      expect(result.deckIds).toHaveLength(2);
      expect(new Set(result.deckIds).size).toBe(2);

      // Both decks should be named after the Anki decks
      const deckNames = result.deckIds.map(
        (id) =>
          (db.prepare("SELECT name FROM decks WHERE id = ?").get(id) as { name: string }).name
      );
      expect(deckNames).toContain("Japanese");
      expect(deckNames).toContain("English");

      // Each app deck should contain exactly 1 note (notes are 1:1 with Anki notes;
      // card count may be >1 when the Japanese analysis path fires)
      for (const deckId of result.deckIds) {
        const noteCount = (
          db.prepare("SELECT COUNT(*) AS c FROM notes WHERE deck_id = ?").get(deckId) as { c: number }
        ).c;
        expect(noteCount).toBe(1);
      }
    } finally {
      fs.unlink(tmp, () => {});
    }
  });

  it("converts Anki sub-deck separator '::' to ' > ' in the display name", async () => {
    const tmp = await buildApkg({
      models: { "7002": { fields: ["Front", "Back"] } },
      decks: { "2001": { name: "Japanese::N5::Vocab" } },
      notes: [{ id: 1, mid: 7002, flds: "猫\x1fcat", tags: "" }],
      cards: [{ id: 1, nid: 1, ord: 0, did: 2001 }],
    });
    try {
      const result = await importApkg(tmp, "Fallback");
      const name = (
        db.prepare("SELECT name FROM decks WHERE id = ?").get(result.deckId) as { name: string }
      ).name;
      expect(name).toBe("Japanese > N5 > Vocab");
    } finally {
      fs.unlink(tmp, () => {});
    }
  });
});

// ---------------------------------------------------------------------------
// A5 — Template-based field mapping (fields are NOT at index 0/1)
// ---------------------------------------------------------------------------

describe("A5 — Template-based field mapping", () => {
  it("uses qfmt/afmt field references, not always parts[0]/parts[1]", async () => {
    // Fields in reversed order: Definition (idx 0) then Term (idx 1).
    // The template's qfmt references {{Term}} so the question should come from idx 1.
    const tmp = await buildApkg({
      models: {
        "6001": {
          fields: ["Definition", "Term"],
          type: 0,
          tmpls: [
            {
              name: "Card 1",
              qfmt: "{{Term}}",
              afmt: "{{FrontSide}}<hr>{{Definition}}",
            },
          ],
        },
      },
      notes: [{ id: 1, mid: 6001, flds: "the sky is blue\x1fThe sky", tags: "" }],
      cards: [{ id: 1, nid: 1, ord: 0 }],
    });

    try {
      const result = await importApkg(tmp, "Template Deck");
      const cards = db
        .prepare("SELECT question, answer FROM cards WHERE deck_id = ?")
        .all(result.deckId) as { question: string; answer: string }[];

      expect(cards).toHaveLength(1);
      const q = JSON.parse(cards[0].question) as { text: string };
      const a = JSON.parse(cards[0].answer) as { text: string };

      // Question must come from the Term field (idx 1), not Definition (idx 0)
      expect(q.text).toBe("The sky");
      expect(a.text).toBe("the sky is blue");
    } finally {
      fs.unlink(tmp, () => {});
    }
  });
});

// ---------------------------------------------------------------------------
// A6 — Orphaned notes (notes table has a row, cards table does not)
// ---------------------------------------------------------------------------

describe("A6 — Orphaned notes (no card row)", () => {
  it("imports orphaned notes with a single basic card using ord=0 fallback", async () => {
    const SQL = await initSqlJs();
    const sqlDb = new SQL.Database();
    sqlDb.run(`
      CREATE TABLE col  (id INTEGER PRIMARY KEY, models TEXT, decks TEXT);
      CREATE TABLE notes(id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT, tags TEXT);
      CREATE TABLE cards(id INTEGER PRIMARY KEY, nid INTEGER, ord INTEGER, did INTEGER);
    `);
    sqlDb.run("INSERT INTO col VALUES (1, '{}', '{}')");
    // Note 1: has a matching card (normal)
    sqlDb.run("INSERT INTO notes VALUES (1, 1, 'question\x1fanswer', '')");
    sqlDb.run("INSERT INTO cards VALUES (1, 1, 0, 1)");
    // Note 2: orphaned — no entry in cards table
    sqlDb.run("INSERT INTO notes VALUES (2, 1, 'orphan_q\x1forphan_a', '')");

    const data = Buffer.from(sqlDb.export());
    sqlDb.close();

    const zip = new AdmZip();
    zip.addFile("collection.anki21", data);
    zip.addFile("media", Buffer.from("{}"));

    const tmp = path.join(os.tmpdir(), `orphan-${Date.now()}.apkg`);
    fs.writeFileSync(tmp, zip.toBuffer());

    try {
      const result = await importApkg(tmp, "Orphan Deck");
      // Both notes should produce a card (orphan falls back to ord=0)
      expect(result.cardsImported).toBe(2);

      const cards = db
        .prepare("SELECT question FROM cards WHERE deck_id = ?")
        .all(result.deckId) as { question: string }[];
      const questions = cards.map((c) => JSON.parse(c.question).text as string);
      expect(questions).toContain("question");
      expect(questions).toContain("orphan_q");
    } finally {
      fs.unlink(tmp, () => {});
    }
  });
});

// ---------------------------------------------------------------------------
// A7 — HTML-heavy fields
// ---------------------------------------------------------------------------

describe("A7 — HTML-heavy fields", () => {
  it("strips HTML tags and inline styles from question and answer", async () => {
    const tmp = await buildApkg({
      models: { "5001": { fields: ["Front", "Back"] } },
      notes: [
        {
          id: 1,
          mid: 5001,
          flds: '<b>Bold</b> text<div style="font-size:14px">More</div>\x1f<span class="hint">hint here</span>',
          tags: "",
        },
      ],
      cards: [{ id: 1, nid: 1, ord: 0 }],
    });

    try {
      const result = await importApkg(tmp, "HTML Deck");
      const cards = db
        .prepare("SELECT question, answer FROM cards WHERE deck_id = ?")
        .all(result.deckId) as { question: string; answer: string }[];

      const q = JSON.parse(cards[0].question) as { text: string };
      const a = JSON.parse(cards[0].answer) as { text: string };

      // No raw HTML should remain in the card text
      expect(q.text).not.toMatch(/<[^>]+>/);
      expect(a.text).not.toMatch(/<[^>]+>/);

      // Content should still be present
      expect(q.text).toContain("Bold");
      expect(q.text).toContain("More");
      expect(a.text).toContain("hint here");
    } finally {
      fs.unlink(tmp, () => {});
    }
  });
});

// ---------------------------------------------------------------------------
// A8 — Japanese content in a multi-template (reversed-card) notetype
// ---------------------------------------------------------------------------

describe("A8 — Japanese content in a multi-template notetype", () => {
  it("generates 2 cards (matching the note's 2 templates), not a Japanese vocab bundle", async () => {
    // "Basic (and reversed card)"-style model: 2 templates (Front→Back, Back→Front),
    // generic field names ("Front"/"Back"), but content-sniffing detects Japanese
    // (学生 contains kanji) and would previously have flagged isJapaneseDeck and
    // routed through vocabNote(), overriding the note's 2-template structure with
    // an unrelated 4-card bundle (vocab/production/listening/pitch).
    const tmp = await buildApkg({
      models: {
        "7001": {
          fields: ["Front", "Back"],
          type: 0,
          tmpls: [
            {
              name: "Card 1",
              qfmt: "{{Front}}",
              afmt: "{{FrontSide}}<hr id=answer>{{Back}}",
            },
            {
              name: "Card 2",
              qfmt: "{{Back}}",
              afmt: "{{FrontSide}}<hr id=answer>{{Front}}",
            },
          ],
        },
      },
      notes: [{ id: 1, mid: 7001, flds: "学生\x1fstudent", tags: "" }],
      cards: [
        { id: 1, nid: 1, ord: 0 },
        { id: 2, nid: 1, ord: 1 },
      ],
    });

    try {
      const result = await importApkg(tmp, "Reversed Japanese Deck");

      // Card count/direction tracks the source's 2 templates — not an
      // unrelated multi-card bundle (which would produce 4 cards).
      expect(result.cardsImported).toBe(2);

      const cards = db
        .prepare("SELECT card_type, question, answer FROM cards WHERE deck_id = ? ORDER BY id")
        .all(result.deckId) as { card_type: string; question: string; answer: string }[];

      expect(cards).toHaveLength(2);

      // Both cards must be plain "basic" template cards, not vocab/listening/pitch.
      for (const c of cards) {
        expect(c.card_type).toBe("basic");
      }

      const q0 = JSON.parse(cards[0].question) as { text: string };
      const a0 = JSON.parse(cards[0].answer) as { text: string };
      const q1 = JSON.parse(cards[1].question) as { text: string };
      const a1 = JSON.parse(cards[1].answer) as { text: string };

      // ord 0: Front→Back (学生 → student)
      expect(q0.text).toBe("学生");
      expect(a0.text).toBe("student");
      // ord 1: Back→Front (student → 学生) — reversed direction respected
      expect(q1.text).toBe("student");
      expect(a1.text).toBe("学生");

      // Japanese content provenance is still captured: note_analyses rows
      // exist for the term, even though no vocab/listening/pitch cards
      // were generated.
      // Scope by deck_id (unique to this import), not just ankiNoteId, since
      // other tests in this file also import notes with Anki note id 1 into
      // the same shared app db.
      const note = db
        .prepare("SELECT id FROM notes WHERE source_location = ? AND deck_id = ?")
        .get(JSON.stringify({ ankiNoteId: 1 }), result.deckId) as { id: number } | undefined;
      expect(note).toBeDefined();

      const analyses = db
        .prepare("SELECT surface, kind FROM note_analyses WHERE note_id = ?")
        .all(note!.id) as { surface: string; kind: string }[];

      expect(analyses.length).toBeGreaterThan(0);
      expect(analyses.some((a) => a.surface.includes("学生"))).toBe(true);
    } finally {
      fs.unlink(tmp, () => {});
    }
  });
});
