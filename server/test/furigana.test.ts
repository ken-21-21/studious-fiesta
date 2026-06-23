import { describe, it, expect } from "vitest";
import { splitOkurigana } from "../src/lib/jp/tokenizer.js";
import { generateLessonNotes } from "../src/lib/cardgen.js";
import type { Lesson } from "../src/lib/segment.js";

describe("splitOkurigana", () => {
  it("pure-kanji compound: whole-token ruby, no split", () => {
    // 天気: no kana in surface → no suffix/prefix match → one segment
    expect(splitOkurigana("天気", "てんき")).toEqual([{ text: "天気", reading: "てんき" }]);
  });

  it("trailing-okurigana verb: splits kanji run from kana suffix", () => {
    // 食べる / たべる → 食 with reading た, べる with no reading
    expect(splitOkurigana("食べる", "たべる")).toEqual([
      { text: "食", reading: "た" },
      { text: "べる" },
    ]);
  });

  it("trailing-okurigana adjective: splits correctly", () => {
    // 美しい / うつくしい → 美 with reading うつく, しい with no reading
    expect(splitOkurigana("美しい", "うつくしい")).toEqual([
      { text: "美", reading: "うつく" },
      { text: "しい" },
    ]);
  });

  it("leading kana prefix: splits honorific prefix from kanji", () => {
    // お茶 / おちゃ → お with no reading, 茶 with reading ちゃ
    expect(splitOkurigana("お茶", "おちゃ")).toEqual([
      { text: "お" },
      { text: "茶", reading: "ちゃ" },
    ]);
  });

  it("pure kana token: returns no-reading segment (no ruby)", () => {
    // No kanji in surface → simple passthrough
    expect(splitOkurigana("べる", "べる")).toEqual([{ text: "べる" }]);
  });

  it("no matching kana edge: falls back to whole-token ruby", () => {
    // 学校 / がっこう — all kanji, no kana boundary match → whole-token
    expect(splitOkurigana("学校", "がっこう")).toEqual([
      { text: "学校", reading: "がっこう" },
    ]);
  });

  it("mismatched reading (impossible surface/reading pair): safe fallback", () => {
    // If reading shares no kana boundary with surface, do not crash or produce
    // a wrong split — return whole-token ruby.
    expect(splitOkurigana("食べる", "たった")).toEqual([
      { text: "食べる", reading: "たった" },
    ]);
  });

  it("single kanji with whole reading: whole-token ruby", () => {
    expect(splitOkurigana("音", "おと")).toEqual([{ text: "音", reading: "おと" }]);
  });
});

describe("furigana okurigana splitting in generated cards", () => {
  function sentenceLesson(lines: string[]): Lesson {
    return {
      number: 1,
      title: "Test",
      sections: [{ type: "grammar", title: "Grammar", lines }],
    };
  }

  it("uncertain token: whole-token uncertain segment, no split", async () => {
    // 開く is ambiguous (あく/ひらく) → needsReview → must produce uncertain: true
    // whole-token segment, never split.
    const lesson = sentenceLesson(["ドアが開く音がした。"]);
    const notes = await generateLessonNotes(lesson);
    const listening = notes[0]?.cards.find((c) => c.cardType === "listening");
    expect(listening).toBeTruthy();
    const furigana = (listening!.answer as any).furigana as Array<{
      text: string;
      reading?: string;
      uncertain?: boolean;
    }>;
    // The uncertain token should appear once, whole, with uncertain: true
    const seg = furigana.find((s) => s.text === "開く");
    expect(seg).toBeTruthy();
    expect(seg!.uncertain).toBe(true);
    expect(seg!.reading).toBeUndefined();
    // It must not have been split into sub-segments
    const splitSeg = furigana.find((s) => s.text === "開");
    expect(splitSeg).toBeUndefined();
  });

  it("confident kanji token: furigana segment carries reading", async () => {
    // 音 should be oto with confident reading after fixing okurigana path
    const lesson = sentenceLesson(["ドアが開く音がした。"]);
    const notes = await generateLessonNotes(lesson);
    const listening = notes[0]?.cards.find((c) => c.cardType === "listening");
    const furigana = (listening!.answer as any).furigana as Array<{
      text: string;
      reading?: string;
      uncertain?: boolean;
    }>;
    const oto = furigana.find((s) => s.text === "音");
    expect(oto).toBeTruthy();
    expect(oto!.reading).toBe("おと");
    expect(oto!.uncertain).toBeFalsy();
  });
});
