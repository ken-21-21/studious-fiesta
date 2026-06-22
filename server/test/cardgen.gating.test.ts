import { describe, it, expect } from "vitest";
import { generateLessonNotes } from "../src/lib/cardgen.js";
import type { Lesson } from "../src/lib/segment.js";

function vocabLesson(lines: string[]): Lesson {
  return { number: 1, title: "Test", sections: [{ type: "vocabulary", title: "Vocab", lines }] };
}

describe("study-material gating on reading confidence", () => {
  it("does not generate reading-dependent cards from a low-confidence reading", async () => {
    // 生物 has no dominant reading → uncertain → must be gated.
    const notes = await generateLessonNotes(vocabLesson(["生物 living thing / raw food"]));
    expect(notes).toHaveLength(1);
    const note = notes[0];

    expect(note.tags).toContain("needs_review");
    // Only the meaning-recognition card (which asserts no reading) survives.
    const types = note.cards.map((c) => c.cardType);
    expect(types).toEqual(["vocab"]);
    expect(types).not.toContain("pitch");
    expect(types).not.toContain("listening");

    // The surviving card must not assert a confident reading, and must expose
    // the ambiguity + alternatives for the learner.
    const q = note.cards[0].question as any;
    expect(q.reading).toBeUndefined();
    expect(q.readingUncertain).toBe(true);
    expect(Array.isArray(q.readingAlternatives)).toBe(true);
  });

  it("generates full card set when the source supplies a trusted reading", async () => {
    // A reading column (がっこう) is source-provided → trusted → full set,
    // including the pitch card from the seeded offline dataset.
    const notes = await generateLessonNotes(vocabLesson(["学校 がっこう school"]));
    const note = notes[0];
    expect(note.tags).toContain("vocabulary");
    const types = note.cards.map((c) => c.cardType);
    expect(types).toContain("vocab");
    expect(types).toContain("listening");
    expect(types).toContain("pitch");
  });

  it("gates readings on sentence cloze and scramble cards", async () => {
    // これは生物だ。 — pickJpClozeIndex blanks the middle content word, which
    // for this sentence is 生物 (ambiguous: living thing / raw food).
    const lesson: Lesson = {
      number: 1,
      title: "Test",
      sections: [{ type: "grammar", title: "Sentences", lines: ["これは生物だ。"] }],
    };
    const notes = await generateLessonNotes(lesson);
    expect(notes).toHaveLength(1);
    const note = notes[0];

    const cloze = note.cards.find((c) => c.cardType === "cloze");
    expect(cloze).toBeTruthy();
    // Cloze targets "生物" which is ambiguous.
    expect((cloze!.answer as any).reading).toBeUndefined();
    expect((cloze!.answer as any).readingUncertain).toBe(true);
    expect(Array.isArray((cloze!.answer as any).readingAlternatives)).toBe(true);

    const scramble = note.cards.find((c) => c.cardType === "scramble");
    expect(scramble).toBeTruthy();
    expect((scramble!.answer as any).reading).toBeUndefined();
    expect((scramble!.answer as any).readingUncertain).toBe(true);
  });
});
