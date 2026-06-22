import { describe, it, expect } from "vitest";
import { canonicalizeSpeech } from "../src/lib/jp/colloquial.js";

describe("natural-speech canonicalization", () => {
  it.each([
    ["食べてる", "食べている"],
    ["何してんの", "何しているの"],
    ["そうじゃない", "そうではない"],
    ["っていうか", "というか"],
  ])("expands %s → %s and records the reduction", (spoken, canonical) => {
    const a = canonicalizeSpeech(spoken);
    expect(a.canonical).toBe(canonical);
    expect(a.spoken).toBe(spoken);
    expect(a.reductions.length).toBeGreaterThan(0);
  });

  it("leaves an already-canonical form unchanged with no reductions", () => {
    const a = canonicalizeSpeech("何をしているの");
    expect(a.canonical).toBe("何をしているの");
    expect(a.reductions).toHaveLength(0);
  });

  it("preserves both spoken and canonical forms separately", () => {
    const a = canonicalizeSpeech("ている");
    // canonical equals input here; the point is both fields always exist.
    expect(a).toHaveProperty("spoken", "ている");
    expect(a).toHaveProperty("canonical");
  });
});
