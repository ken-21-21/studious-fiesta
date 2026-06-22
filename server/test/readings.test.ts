import { describe, it, expect } from "vitest";
import { disambiguateReading } from "../src/lib/jp/readings.js";
import { tokenize } from "../src/lib/jp/tokenizer.js";

const ANALYZER = { analyzerName: "kuromoji", analyzerVersion: "ipadic-0.1.2" };

function decide(surface: string, analyzerReading: string | null) {
  return disambiguateReading({ surface, hasKanji: true, analyzerReading, ...ANALYZER });
}

describe("context-sensitive reading disambiguation", () => {
  it("flags genuinely ambiguous spellings for review and keeps every alternative", () => {
    // 生物: せいぶつ (biology) vs なまもの (raw food) — no dominant reading.
    const seibutsu = decide("生物", "せいぶつ");
    expect(seibutsu.needsReview).toBe(true);
    expect(seibutsu.band).toBe("low");
    const all = [seibutsu.selected, ...seibutsu.alternatives];
    expect(all).toContain("せいぶつ");
    expect(all).toContain("なまもの");
  });

  it.each([
    ["人気", ["にんき", "ひとけ"]],
    ["上手", ["じょうず", "うわて", "かみて"]],
    ["辛い", ["からい", "つらい"]],
    ["開く", ["あく", "ひらく"]],
    ["大人気", ["だいにんき", "おとなげ"]],
  ])("marks %s ambiguous and preserves its readings", (surface, readings) => {
    const d = decide(surface, readings[0]);
    expect(d.needsReview).toBe(true);
    const all = new Set([d.selected, ...d.alternatives]);
    for (const r of readings) expect(all).toContain(r);
  });

  it("accepts a dominant everyday reading but still records alternatives", () => {
    // 今日 is overwhelmingly きょう; こんにち is kept as an alternative.
    const kyou = decide("今日", "きょう");
    expect(kyou.selected).toBe("きょう");
    expect(kyou.needsReview).toBe(false);
    expect(kyou.band).toBe("medium");
    expect(kyou.alternatives).toContain("こんにち");

    const hitori = decide("一人", "ひとり");
    expect(hitori.selected).toBe("ひとり");
    expect(hitori.needsReview).toBe(false);
    expect(hitori.alternatives).toContain("いちにん");
  });

  it("treats analyzer/dominant disagreement as needing review", () => {
    // 明日 dominant is あした; if the analyzer insists on みょうにち, that conflict
    // is surfaced rather than silently accepted.
    const d = decide("明日", "みょうにち");
    expect(d.needsReview).toBe(true);
    expect(new Set([d.selected, ...d.alternatives])).toContain("みょうにち");
  });

  it("trusts an unambiguous common kanji word with high-ish confidence", () => {
    const d = decide("学校", "がっこう");
    expect(d.selected).toBe("がっこう");
    expect(d.needsReview).toBe(false);
    expect(d.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("declines to commit when the analyzer cannot read a kanji form", () => {
    const d = decide("熙", null); // obscure kanji, no reading
    expect(d.selected).toBeNull();
    expect(d.needsReview).toBe(true);
    expect(d.band).toBe("low");
  });

  it("end-to-end: tokens carry an inspectable reading decision", async () => {
    const tokens = await tokenize("生物を食べる。");
    const seibutsu = tokens.find((t) => t.surface === "生物");
    expect(seibutsu).toBeTruthy();
    expect(seibutsu!.readingDecision.needsReview).toBe(true);
    // Uncertain reading must not produce confident furigana.
    expect(seibutsu!.furigana).toBeNull();
  });
});
