import { describe, it, expect } from "vitest";
import { tokenize } from "../src/lib/jp/tokenizer.js";

describe("kuromoji/kanjium pipeline integration (tokenize)", () => {
  it("normalizes text before tokenization", async () => {
    // Zero-width spaces, full-width alphanumeric, half-width katakana
    const inputClean = "\uFF34\uFF45\uFF53\uFF54\u200B\u30BB\u30F3\u30BF\u200D\uFF70";
    
    const tokens = await tokenize(inputClean);
    expect(tokens.map(t => t.surface).join("")).toBe("Test\u30BB\u30F3\u30BF\u30FC");
  });

  it("handles empty strings", async () => {
    const tokens = await tokenize("");
    expect(tokens).toEqual([]);
  });

  it("handles sentences with weird spacing and normalizes them correctly", async () => {
    // "これ　　は　テスト"
    const tokens = await tokenize("\u3053\u308C\u3000\u3000\u306F\u3000\u30C6\u30B9\u30C8");
    expect(tokens.some(t => t.surface === "\u3000")).toBe(true);
  });

  it("provides reading decisions for all tokens", async () => {
    // "日本語を学ぶ"
    const tokens = await tokenize("\u65E5\u672C\u8A9E\u3092\u5B66\u3076");
    const nihongo = tokens.find(t => t.surface === "\u65E5\u672C\u8A9E");
    expect(nihongo).toBeDefined();
    expect(nihongo!.reading).toBe("\u306B\u307B\u3093\u3054");
    expect(nihongo!.readingDecision).toBeDefined();
    expect(nihongo!.readingDecision.needsReview).toBe(false);
  });

  it("identifies content words correctly for cloze generation", async () => {
    // "猫が好きです"
    const tokens = await tokenize("\u732B\u304C\u597D\u304D\u3067\u3059");
    const neko = tokens.find(t => t.surface === "\u732B");
    expect(neko!.isContentWord).toBe(true);

    const ga = tokens.find(t => t.surface === "\u304C");
    expect(ga!.isContentWord).toBe(false); // particle
  });
});
