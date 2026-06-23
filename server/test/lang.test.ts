import { describe, it, expect } from "vitest";
import { classify, isJapaneseDoc, splitSentences } from "../src/lib/lang.js";

describe("classify", () => {
  it("classifies pure Japanese text as ja", () => {
    expect(classify("これは日本語の文章です。")).toBe("ja");
  });

  it("classifies pure English text as en", () => {
    expect(classify("This is an English sentence.")).toBe("en");
  });

  it("classifies a mostly-English sentence with a little Japanese as mixed", () => {
    // A short Japanese aside dropped into an otherwise English sentence.
    expect(classify("This word means こんにちは in Japanese, roughly.")).toBe("mixed");
  });

  it("classifies empty text as en (no Japanese present)", () => {
    expect(classify("")).toBe("en");
  });
});

describe("isJapaneseDoc", () => {
  it("returns true once Japanese content crosses the 15% threshold", () => {
    expect(isJapaneseDoc("こんにちは、世界。")).toBe(true);
  });

  it("returns false for predominantly English text with a trivial Japanese fragment", () => {
    const text = "This is a long English paragraph used to test the threshold logic. ".repeat(5) + "猫";
    expect(isJapaneseDoc(text)).toBe(false);
  });

  it("returns false for empty text", () => {
    expect(isJapaneseDoc("")).toBe(false);
  });
});

describe("splitSentences", () => {
  it("splits on Japanese terminators", () => {
    const out = splitSentences("これは文1です。これは文2です。これは文3ですか？");
    expect(out).toEqual(["これは文1です。", "これは文2です。", "これは文3ですか？"]);
  });

  it("splits on English terminators followed by whitespace", () => {
    const out = splitSentences("This is sentence one. This is sentence two! Is this three?");
    expect(out).toEqual(["This is sentence one.", "This is sentence two!", "Is this three?"]);
  });

  it("splits mixed Japanese/English text correctly", () => {
    const out = splitSentences("猫 means cat. 犬は dog です。");
    expect(out).toEqual(["猫 means cat.", "犬は dog です。"]);
  });

  it("collapses full-width and irregular whitespace within a sentence", () => {
    const out = splitSentences("これは　全角スペース　を含む文です。");
    expect(out).toEqual(["これは 全角スペース を含む文です。"]);
  });

  it("returns an empty array for blank input", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   \n\n  ")).toEqual([]);
  });

  it("splits on bare newlines even without terminal punctuation", () => {
    const out = splitSentences("line one\nline two");
    expect(out).toEqual(["line one", "line two"]);
  });
});
