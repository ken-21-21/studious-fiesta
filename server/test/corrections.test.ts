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

  it("does not back-apply scoped (non-global/matching) corrections to existing rows", () => {
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
});
