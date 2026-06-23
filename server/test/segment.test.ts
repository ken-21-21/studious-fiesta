import { describe, it, expect } from "vitest";
import { segmentTextbook } from "../src/lib/segment.js";

describe("segmentTextbook", () => {
  it("wraps unstructured text into a single implicit lesson/content section", () => {
    const lessons = segmentTextbook("Just some plain text.\nAnother line.");
    expect(lessons).toHaveLength(1);
    expect(lessons[0].number).toBeNull();
    expect(lessons[0].sections).toHaveLength(1);
    expect(lessons[0].sections[0].type).toBe("content");
    expect(lessons[0].sections[0].lines).toEqual(["Just some plain text.", "Another line."]);
  });

  it("detects English lesson headers and following section headers", () => {
    const text = [
      "Lesson 1: Greetings",
      "Vocabulary",
      "こんにちは hello",
      "Grammar",
      "です is a copula",
    ].join("\n");
    const lessons = segmentTextbook(text);
    expect(lessons).toHaveLength(1);
    expect(lessons[0].number).toBe(1);
    expect(lessons[0].title).toBe("Greetings");
    expect(lessons[0].sections.map((s) => s.type)).toEqual(["vocabulary", "grammar"]);
    expect(lessons[0].sections[0].lines).toEqual(["こんにちは hello"]);
    expect(lessons[0].sections[1].lines).toEqual(["です is a copula"]);
  });

  it("detects Japanese lesson headers (第N課)", () => {
    const text = "第3課：買い物\n会話\nいらっしゃいませ。";
    const lessons = segmentTextbook(text);
    expect(lessons).toHaveLength(1);
    expect(lessons[0].number).toBe(3);
    expect(lessons[0].title).toBe("買い物");
    expect(lessons[0].sections[0].type).toBe("dialogue");
  });

  it("detects だいN課 kana-style lesson headers", () => {
    const text = "だい5か\n単語\n猫";
    const lessons = segmentTextbook(text);
    expect(lessons[0].number).toBe(5);
    expect(lessons[0].sections[0].type).toBe("vocabulary");
  });

  it("detects the short 'L N' lesson header form", () => {
    const text = "L3\nPractice\nDo exercise 1";
    const lessons = segmentTextbook(text);
    expect(lessons[0].number).toBe(3);
    expect(lessons[0].sections[0].type).toBe("practice");
  });

  it("creates multiple lessons when multiple lesson headers appear", () => {
    const text = [
      "Lesson 1: A",
      "Vocabulary",
      "line one",
      "Lesson 2: B",
      "Grammar",
      "line two",
    ].join("\n");
    const lessons = segmentTextbook(text);
    expect(lessons).toHaveLength(2);
    expect(lessons[0].title).toBe("A");
    expect(lessons[1].title).toBe("B");
    expect(lessons[1].sections[0].type).toBe("grammar");
  });

  it("starts an implicit content section for lines preceding any section header", () => {
    const text = "Lesson 1: Intro\nSome unlabeled content line.\nVocabulary\nactual vocab line";
    const lessons = segmentTextbook(text);
    expect(lessons[0].sections).toHaveLength(2);
    expect(lessons[0].sections[0].type).toBe("content");
    expect(lessons[0].sections[0].lines).toEqual(["Some unlabeled content line."]);
    expect(lessons[0].sections[1].type).toBe("vocabulary");
  });

  it("does not treat a long prose line that merely mentions 'lesson' as a header", () => {
    const longLine =
      "In this lesson 1 we will explore many different grammar points that span well past the sixty character limit.";
    const lessons = segmentTextbook(longLine);
    // Falls through to the no-structure-detected wrapper since the line is
    // too long to match as a lesson header.
    expect(lessons).toHaveLength(1);
    expect(lessons[0].number).toBeNull();
    expect(lessons[0].sections[0].type).toBe("content");
  });

  it("does not treat a long line that merely contains a section keyword as a header", () => {
    const longLine =
      "Grammar points like this one can appear inside a sentence that runs long enough to exceed the fifty character section cutoff.";
    const lessons = segmentTextbook(`Lesson 1: X\n${longLine}`);
    expect(lessons[0].sections).toHaveLength(1);
    expect(lessons[0].sections[0].type).toBe("content");
  });

  it("skips blank lines without creating empty sections", () => {
    const text = "Lesson 1: X\nVocabulary\n\n\n犬 dog\n";
    const lessons = segmentTextbook(text);
    expect(lessons[0].sections).toHaveLength(1);
    expect(lessons[0].sections[0].lines).toEqual(["犬 dog"]);
  });

  it("creates lessons with zero sections when a header is immediately followed by another header", () => {
    // A lesson header immediately followed by another lesson header, with no
    // body lines in between, still produces a lesson entry (empty sections);
    // callers (e.g. jobs.ts) are documented to filter these out themselves.
    const text = "Lesson 1: A\nLesson 2: B\nVocabulary\nfoo";
    const lessons = segmentTextbook(text);
    expect(lessons).toHaveLength(2);
    expect(lessons[0].sections).toHaveLength(0);
    expect(lessons[1].sections).toHaveLength(1);
  });
});
