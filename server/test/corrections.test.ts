import { describe, it, expect, vi } from "vitest";
import { addCorrection, reGateExistingAnalyses, getReadingCorrection } from "../src/lib/corrections.js";
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

  it("skips a row with corrupted alternatives JSON but still updates the other matching rows", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('Test Deck Corrupt')").run().lastInsertRowid);
      const noteGood1 = Number(
        db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
          .run(deckId).lastInsertRowid
      );
      const noteBad = Number(
        db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
          .run(deckId).lastInsertRowid
      );
      const noteGood2 = Number(
        db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
          .run(deckId).lastInsertRowid
      );

      const insertAnalysis = db.prepare(`
        INSERT INTO note_analyses (note_id, kind, surface, label, confidence, band, needs_review, alternatives, evidence, payload)
        VALUES (?, 'reading', '走る', 'はしる', 0.4, 'low', 1, ?, '[]', '{}')
      `);
      insertAnalysis.run(noteGood1, "[]");
      // Corrupted alternatives payload, e.g. from a bad prior import or manual DB edit.
      insertAnalysis.run(noteBad, "{not valid json");
      insertAnalysis.run(noteGood2, "[]");

      const { analysesUpdated } = reGateExistingAnalyses({
        kind: "reading",
        surface: "走る",
        value: "そうる",
        scope: "global",
      });

      // Only the two uncorrupted rows count as updated; the corrupted one is
      // skipped rather than aborting the whole batch.
      expect(analysesUpdated).toBe(2);
      expect(errorSpy).toHaveBeenCalled();
      expect(String(errorSpy.mock.calls[0][0])).toContain("note_analyses row id=");

      const rowGood1 = db.prepare("SELECT label FROM note_analyses WHERE note_id = ?").get(noteGood1) as any;
      const rowBad = db.prepare("SELECT label FROM note_analyses WHERE note_id = ?").get(noteBad) as any;
      const rowGood2 = db.prepare("SELECT label FROM note_analyses WHERE note_id = ?").get(noteGood2) as any;

      expect(rowGood1.label).toBe("そうる");
      expect(rowGood2.label).toBe("そうる");
      // The corrupted row is left untouched rather than half-patched.
      expect(rowBad.label).toBe("はしる");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("skips a card with corrupted question/answer JSON but still patches other cards on the same note", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('Test Deck Card Corrupt')").run().lastInsertRowid);
      const noteId = Number(
        db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
          .run(deckId).lastInsertRowid
      );
      db.prepare(`
        INSERT INTO note_analyses (note_id, kind, surface, label, confidence, band, needs_review, alternatives, evidence, payload)
        VALUES (?, 'reading', '泳ぐ', 'えいぐ', 0.4, 'low', 1, '[]', '[]', '{}')
      `).run(noteId);

      const goodCardId = Number(
        db.prepare(`
          INSERT INTO cards (note_id, deck_id, card_type, question, answer)
          VALUES (?, ?, 'vocab', ?, ?)
        `).run(
          noteId,
          deckId,
          JSON.stringify({ text: "泳ぐ", reading: "えいぐ", readingUncertain: true }),
          JSON.stringify({ text: "to swim" })
        ).lastInsertRowid
      );
      const badCardId = Number(
        db.prepare(`
          INSERT INTO cards (note_id, deck_id, card_type, question, answer)
          VALUES (?, ?, 'vocab', ?, ?)
        `).run(noteId, deckId, "{not valid json", JSON.stringify({ text: "to swim" })).lastInsertRowid
      );

      const { analysesUpdated, cardsUpdated } = reGateExistingAnalyses({
        kind: "reading",
        surface: "泳ぐ",
        value: "およぐ",
        scope: "global",
      });

      expect(analysesUpdated).toBe(1);
      // Only the good card counts as updated; the corrupted one is skipped.
      expect(cardsUpdated).toBe(1);
      expect(errorSpy).toHaveBeenCalled();

      const goodCard = db.prepare("SELECT question FROM cards WHERE id = ?").get(goodCardId) as any;
      const badCard = db.prepare("SELECT question FROM cards WHERE id = ?").get(badCardId) as any;
      expect(JSON.parse(goodCard.question).reading).toBe("およぐ");
      // Corrupted row left exactly as-is, not silently dropped or replaced.
      expect(badCard.question).toBe("{not valid json");
    } finally {
      errorSpy.mockRestore();
    }
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

  it("back-applies a matching-scoped correction globally, same as 'global' (matching has no extra context to filter on for existing rows)", () => {
    const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('Deck Matching')").run().lastInsertRowid);
    const noteA = Number(
      db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
        .run(deckId).lastInsertRowid
    );
    const noteB = Number(
      db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
        .run(deckId).lastInsertRowid
    );
    for (const noteId of [noteA, noteB]) {
      db.prepare(`
        INSERT INTO note_analyses (note_id, kind, surface, label, confidence, band, needs_review, alternatives, evidence, payload)
        VALUES (?, 'reading', '今日', 'きょう', 0.4, 'low', 1, '[]', '[]', '{}')
      `).run(noteId);
    }

    const { analysesUpdated, affectedNoteIds } = reGateExistingAnalyses({
      kind: "reading",
      surface: "今日",
      value: "こんにち",
      scope: "matching",
    });

    expect(analysesUpdated).toBe(2);
    expect(affectedNoteIds.sort()).toEqual([noteA, noteB].sort());
    const rowA = db.prepare("SELECT label FROM note_analyses WHERE note_id = ?").get(noteA) as any;
    const rowB = db.prepare("SELECT label FROM note_analyses WHERE note_id = ?").get(noteB) as any;
    expect(rowA.label).toBe("こんにち");
    expect(rowB.label).toBe("こんにち");
  });

  it("does not back-apply corrections of a kind other than reading/grammar (e.g. pitch)", () => {
    const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('Deck Pitch Kind')").run().lastInsertRowid);
    const noteId = Number(
      db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
        .run(deckId).lastInsertRowid
    );
    db.prepare(`
      INSERT INTO note_analyses (note_id, kind, surface, label, confidence, band, needs_review, alternatives, evidence, payload)
      VALUES (?, 'reading', '橋', 'はし', 0.4, 'low', 1, '[]', '[]', '{}')
    `).run(noteId);

    const { analysesUpdated, cardsUpdated, affectedNoteIds } = reGateExistingAnalyses({
      kind: "pitch",
      surface: "橋",
      value: "2",
      scope: "global",
    });

    expect(analysesUpdated).toBe(0);
    expect(cardsUpdated).toBe(0);
    expect(affectedNoteIds).toEqual([]);
  });

  it("does not back-apply when no surface is given", () => {
    const { analysesUpdated, cardsUpdated } = reGateExistingAnalyses({
      kind: "reading",
      value: "なまもの",
      scope: "global",
    });
    expect(analysesUpdated).toBe(0);
    expect(cardsUpdated).toBe(0);
  });

  it("skips rows whose label already equals the corrected value (no-op, not an update)", () => {
    const deckId = Number(db.prepare("INSERT INTO decks (name) VALUES ('Deck Noop')").run().lastInsertRowid);
    const noteId = Number(
      db.prepare("INSERT INTO notes (deck_id, source, fields, tags) VALUES (?, 'manual', '{}', '')")
        .run(deckId).lastInsertRowid
    );
    db.prepare(`
      INSERT INTO note_analyses (note_id, kind, surface, label, confidence, band, needs_review, alternatives, evidence, payload)
      VALUES (?, 'reading', '雨', 'あめ', 0.9, 'high', 0, '[]', '[]', '{}')
    `).run(noteId);

    const { analysesUpdated, affectedNoteIds } = reGateExistingAnalyses({
      kind: "reading",
      surface: "雨",
      value: "あめ",
      scope: "global",
    });

    expect(analysesUpdated).toBe(0);
    expect(affectedNoteIds).toEqual([]);
  });
});

describe("getReadingCorrection scope precedence", () => {
  it("returns null when no correction exists for the surface", () => {
    expect(getReadingCorrection("存在しない表現")).toBeNull();
  });

  it("prefers a more specific (source) scope over a global one for the same surface", () => {
    addCorrection({ kind: "reading", surface: "面白い", value: "おもしろい", scope: "global" });
    addCorrection({
      kind: "reading",
      surface: "面白い",
      value: "おもろい",
      scope: "source",
      context: "src:7",
    });

    // Matching context for the source-scoped correction → the more specific one wins.
    const withContext = getReadingCorrection("面白い", "src:7");
    expect(withContext?.value).toBe("おもろい");
    expect(withContext?.scope).toBe("source");

    // No matching context → only the global correction is eligible.
    const withoutContext = getReadingCorrection("面白い", "src:99");
    expect(withoutContext?.value).toBe("おもしろい");
    expect(withoutContext?.scope).toBe("global");
  });

  it("a 'matching' scoped correction applies regardless of context, like global", () => {
    addCorrection({ kind: "reading", surface: "嫌い", value: "きらい", scope: "matching" });
    const result = getReadingCorrection("嫌い", "any-context-at-all");
    expect(result?.value).toBe("きらい");
    expect(result?.scope).toBe("matching");
  });

  it("a scoped (non-global/matching) correction with no context argument is ignored", () => {
    addCorrection({
      kind: "reading",
      surface: "大事",
      value: "おおごと",
      scope: "sentence",
      context: "sent:1",
    });
    // Caller passes no context at all → scoped correction can't match.
    expect(getReadingCorrection("大事")).toBeNull();
  });
});

describe("addCorrection validation", () => {
  it("rejects an invalid correction kind", () => {
    expect(() => addCorrection({ kind: "bogus" as any, value: "x", scope: "global" })).toThrow(/Invalid correction kind/);
  });

  it("rejects an invalid correction scope", () => {
    expect(() => addCorrection({ kind: "reading", value: "x", scope: "bogus" as any })).toThrow(/Invalid correction scope/);
  });

  it("rejects an empty/whitespace-only value", () => {
    expect(() => addCorrection({ kind: "reading", value: "   ", scope: "global" })).toThrow(/cannot be empty/);
  });

  it("defaults scope to 'global' when omitted", () => {
    const id = addCorrection({ kind: "reading", surface: "雪", value: "ゆき" });
    const row = db.prepare("SELECT scope FROM corrections WHERE id = ?").get(id) as any;
    expect(row.scope).toBe("global");
  });

  it("sanitizes null bytes and trims surrounding whitespace from text fields", () => {
    const id = addCorrection({ kind: "reading", surface: "  火   ", value: "  ひ  ", scope: "global" });
    const row = db.prepare("SELECT surface, value FROM corrections WHERE id = ?").get(id) as any;
    expect(row.surface).toBe("火");
    expect(row.value).toBe("ひ");
  });
});
