import { describe, it, expect } from "vitest";
import { addCorrection, reGateExistingAnalyses } from "../src/lib/corrections.js";
import { disambiguateReading } from "../src/lib/jp/readings.js";
import { db } from "../src/db/index.js";

const ANALYZER = { analyzerName: "kuromoji", analyzerVersion: "ipadic-0.1.2" };

describe("user corrections override analysis", () => {
  it("makes a corrected reading authoritative for future analysis", () => {
    // Before correction, 生物 is ambiguous and flagged for review.
    const before = disambiguateReading({
      surface: "生物",
      hasKanji: true,
      analyzerReading: "せいぶつ",
      ...ANALYZER,
    });
    expect(before.needsReview).toBe(true);

    // The user corrects it to なまもの globally.
    addCorrection({ kind: "reading", surface: "生物", value: "なまもの", scope: "global" });

    const after = disambiguateReading({
      surface: "生物",
      hasKanji: true,
      analyzerReading: "せいぶつ",
      ...ANALYZER,
    });
    expect(after.selected).toBe("なまもの");
    expect(after.needsReview).toBe(false);
    expect(after.confidence).toBe(1);
    expect(after.evidence.some((e) => e.source === "user_correction")).toBe(true);
    // The analyzer's original reading is preserved as an alternative.
    expect(after.alternatives).toContain("せいぶつ");
  });

  it("scopes a correction so it only applies in its context", () => {
    addCorrection({
      kind: "reading",
      surface: "辛い",
      value: "つらい",
      scope: "sentence",
      context: "sent:42",
    });

    // Matching context → correction applies.
    const inContext = disambiguateReading({
      surface: "辛い",
      hasKanji: true,
      analyzerReading: "からい",
      context: "sent:42",
      ...ANALYZER,
    });
    expect(inContext.selected).toBe("つらい");
    expect(inContext.evidence[0].source).toBe("user_correction");

    // Different context → falls back to ambiguous handling (no silent override).
    const otherContext = disambiguateReading({
      surface: "辛い",
      hasKanji: true,
      analyzerReading: "からい",
      context: "sent:99",
      ...ANALYZER,
    });
    expect(otherContext.needsReview).toBe(true);
  });
});

describe("re-gating existing analyses and cards on correction", () => {
  it("marks matching note_analyses corrected and patches card payloads in place", () => {
    const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('Test Deck')").run().lastInsertRowid);
    const noteId = Number(
      db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
        .run(deckId).lastInsertRowid
    );
    db.prepare(`
      INSERT INTO note_analyses (note_id, kind, surface, label, confidence, band, needs_review, alternatives, evidence, payload)
      VALUES (?, 'reading', '生物', 'せいぶつ', 0.4, 'low', 1, '[]', '[]', '{}')
    `).run(noteId);
    const cardId = Number(
      db.prepare(`
        INSERT INTO cards (note_id, deck_id, card_type, question, answer)
        VALUES (?, ?, 'vocab', ?, ?)
      `).run(
        noteId,
        deckId,
        JSON.stringify({ text: "生物", reading: "せいぶつ", readingUncertain: true }),
        JSON.stringify({ text: "raw food" })
      ).lastInsertRowid
    );

    const { analysesUpdated, cardsUpdated } = reGateExistingAnalyses({
      kind: "reading",
      surface: "生物",
      value: "なまもの",
      scope: "global",
    });

    expect(analysesUpdated).toBe(1);
    expect(cardsUpdated).toBe(1);

    const analysisRow = db.prepare("SELECT * FROM note_analyses WHERE note_id = ?").get(noteId) as any;
    expect(analysisRow.label).toBe("なまもの");
    expect(analysisRow.needs_review).toBe(0);
    expect(analysisRow.corrected_by_user).toBe(1);
    expect(JSON.parse(analysisRow.alternatives)).toContain("せいぶつ");

    const cardRow = db.prepare("SELECT * FROM cards WHERE id = ?").get(cardId) as any;
    const question = JSON.parse(cardRow.question);
    expect(question.reading).toBe("なまもの");
    expect(question.readingUncertain).toBe(false);
  });

  it("does not back-apply scoped (occurrence/sentence) corrections to existing rows", () => {
    const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('Test Deck 2')").run().lastInsertRowid);
    const noteId = Number(
      db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
        .run(deckId).lastInsertRowid
    );
    db.prepare(`
      INSERT INTO note_analyses (note_id, kind, surface, label, confidence, band, needs_review, alternatives, evidence, payload)
      VALUES (?, 'reading', '辛い', 'からい', 0.4, 'low', 1, '[]', '[]', '{}')
    `).run(noteId);

    const { analysesUpdated, cardsUpdated } = reGateExistingAnalyses({
      kind: "reading",
      surface: "辛い",
      value: "つらい",
      scope: "sentence",
      context: "sent:42",
    });

    expect(analysesUpdated).toBe(0);
    expect(cardsUpdated).toBe(0);
  });

  it("back-applies a deck-scoped correction only to notes in that deck", () => {
    const deckA = Number(db.prepare("INSERT INTO decks (name) VALUES ('Deck A')").run().lastInsertRowid);
    const deckB = Number(db.prepare("INSERT INTO decks (name) VALUES ('Deck B')").run().lastInsertRowid);
    const noteA = Number(
      db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
        .run(deckA).lastInsertRowid
    );
    const noteB = Number(
      db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
        .run(deckB).lastInsertRowid
    );
    for (const noteId of [noteA, noteB]) {
      db.prepare(`
        INSERT INTO note_analyses (note_id, kind, surface, label, confidence, band, needs_review, alternatives, evidence, payload)
        VALUES (?, 'reading', '上手', 'じょうず', 0.35, 'low', 1, '[]', '[]', '{}')
      `).run(noteId);
    }

    const { analysesUpdated, cardsUpdated } = reGateExistingAnalyses({
      kind: "reading",
      surface: "上手",
      value: "うわて",
      scope: "deck",
      deckId: deckA,
    });

    expect(analysesUpdated).toBe(1);
    expect(cardsUpdated).toBe(0); // no cards inserted in this fixture, just analyses

    const rowA = db.prepare("SELECT label FROM note_analyses WHERE note_id = ?").get(noteA) as any;
    const rowB = db.prepare("SELECT label FROM note_analyses WHERE note_id = ?").get(noteB) as any;
    expect(rowA.label).toBe("うわて");
    expect(rowB.label).toBe("じょうず"); // untouched: different deck
  });

  it("does not back-apply a deck-scoped correction when no deckId is given", () => {
    const { analysesUpdated, cardsUpdated } = reGateExistingAnalyses({
      kind: "reading",
      surface: "上手",
      value: "かみて",
      scope: "deck",
    });
    expect(analysesUpdated).toBe(0);
    expect(cardsUpdated).toBe(0);
  });

  it("back-applies a source-scoped correction only to notes from that source", () => {
    const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('Deck C')").run().lastInsertRowid);
    const sourceA = Number(
      db.prepare("INSERT INTO sources (kind, filename) VALUES ('textbook', 'a.txt')").run().lastInsertRowid
    );
    const sourceB = Number(
      db.prepare("INSERT INTO sources (kind, filename) VALUES ('textbook', 'b.txt')").run().lastInsertRowid
    );
    const noteA = Number(
      db.prepare("INSERT INTO notes (deck_id, source, source_id, fields, tags) VALUES (?, 'textbook', ?, '{}', '')")
        .run(deckId, sourceA).lastInsertRowid
    );
    const noteB = Number(
      db.prepare("INSERT INTO notes (deck_id, source, source_id, fields, tags) VALUES (?, 'textbook', ?, '{}', '')")
        .run(deckId, sourceB).lastInsertRowid
    );
    for (const noteId of [noteA, noteB]) {
      db.prepare(`
        INSERT INTO note_analyses (note_id, kind, surface, label, confidence, band, needs_review, alternatives, evidence, payload)
        VALUES (?, 'reading', '開く', 'ひらく', 0.35, 'low', 1, '[]', '[]', '{}')
      `).run(noteId);
    }

    const { analysesUpdated } = reGateExistingAnalyses({
      kind: "reading",
      surface: "開く",
      value: "あく",
      scope: "source",
      sourceId: sourceA,
    });

    expect(analysesUpdated).toBe(1);
    const rowA = db.prepare("SELECT label FROM note_analyses WHERE note_id = ?").get(noteA) as any;
    const rowB = db.prepare("SELECT label FROM note_analyses WHERE note_id = ?").get(noteB) as any;
    expect(rowA.label).toBe("あく");
    expect(rowB.label).toBe("ひらく"); // untouched: different source
  });
});
