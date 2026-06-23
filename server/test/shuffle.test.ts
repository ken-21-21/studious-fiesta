import { describe, it, expect, vi } from "vitest";
import { shuffle, scrambledOrder } from "../src/lib/shuffle.js";

describe("shuffle", () => {
  it("returns an array with the same elements (a permutation)", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input);
    expect(out).toHaveLength(input.length);
    expect([...out].sort()).toEqual([...input].sort());
  });

  it("does not mutate the input array", () => {
    const input = [1, 2, 3];
    const copy = [...input];
    shuffle(input);
    expect(input).toEqual(copy);
  });

  it("handles empty and single-element arrays without error", () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle([1])).toEqual([1]);
  });
});

describe("scrambledOrder", () => {
  it("returns arrays shorter than 2 unchanged", () => {
    expect(scrambledOrder([])).toEqual([]);
    expect(scrambledOrder(["solo"])).toEqual(["solo"]);
  });

  it("returns a permutation containing the same elements", () => {
    const input = ["a", "b", "c", "d"];
    const out = scrambledOrder(input);
    expect([...out].sort()).toEqual([...input].sort());
  });

  it("gives up after repeated retries and still returns a valid permutation, even when Math.random is pathological", () => {
    // With only 2 possible orders for a 2-element array, a pathological
    // Math.random mock that always returns 0 forces shuffle() to always
    // produce the identity order. scrambledOrder's retry loop must still
    // terminate (not infinite-loop) and return *a* permutation of the input.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const out = scrambledOrder(["only", "two"]);
      expect(out.slice().sort()).toEqual(["only", "two"].sort());
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("uses the provided key function to detect the original order for non-primitive items", () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const out = scrambledOrder(items, (x) => String(x.id));
    expect(out.map((x) => x.id).sort()).toEqual([1, 2, 3]);
  });
});
