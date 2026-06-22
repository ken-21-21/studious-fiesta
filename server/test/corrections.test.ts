import { describe, it, expect } from "vitest";
import { addCorrection } from "../src/lib/corrections.js";
import { disambiguateReading } from "../src/lib/jp/readings.js";

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
