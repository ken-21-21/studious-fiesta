import { describe, it, expect } from "vitest";
import { lookupPitch, buildPattern } from "../src/lib/jp/pitch.js";
import { countMorae, splitMorae } from "../src/lib/jp/morae.js";

describe("morae counting and splitting", () => {
  it("counts regular morae", () => {
    expect(countMorae("がっこう")).toBe(4);
    expect(splitMorae("がっこう")).toEqual(["ガ", "ッ", "コ", "ウ"]);
  });
  
  it("fuses yōon and small vowels", () => {
    expect(countMorae("しゃしん")).toBe(3);
    expect(splitMorae("しゃしん")).toEqual(["シャ", "シ", "ン"]);
    
    expect(countMorae("チェック")).toBe(3);
    expect(splitMorae("チェック")).toEqual(["チェ", "ッ", "ク"]);
  });

  it("handles long vowels", () => {
    expect(countMorae("コーヒー")).toBe(4);
    expect(splitMorae("コーヒー")).toEqual(["コ", "ー", "ヒ", "ー"]);
  });
});

describe("pitch dataset and classification", () => {
  it("returns null for unknown words", async () => {
    expect(await lookupPitch("未知の単語", "みちのたんご")).toBeNull();
  });

  it("returns pitch info for known words from the offline dataset", async () => {
    const gakko = await lookupPitch("学校", "がっこう");
    expect(gakko).not.toBeNull();
    expect(gakko!.type).toBe("heiban");
    expect(gakko!.pattern).toEqual(["L", "H", "H", "H"]);
    expect(gakko!.particle).toBe("H");
    
    const sensei = await lookupPitch("先生", "せんせい");
    expect(sensei).not.toBeNull();
    expect(sensei!.type).toBe("nakadaka");
    expect(sensei!.pattern).toEqual(["L", "H", "H", "L"]);
    expect(sensei!.particle).toBe("L");
  });

  it("disambiguates homophones based on reading", async () => {
    const hashi1 = await lookupPitch("箸", "はし");
    expect(hashi1!.type).toBe("atamadaka");
    
    const hashi2 = await lookupPitch("橋", "はし");
    expect(hashi2!.type).toBe("odaka");
  });
});

describe("buildPattern", () => {
  it("builds odaka pattern", () => {
    const p = buildPattern(2, ["ハ", "シ"]);
    expect(p.type).toBe("odaka");
    expect(p.pattern).toEqual(["L", "H"]);
    expect(p.particle).toBe("L");
  });
  it("builds atamadaka pattern", () => {
    const p = buildPattern(1, ["ハ", "シ"]);
    expect(p.type).toBe("atamadaka");
    expect(p.pattern).toEqual(["H", "L"]);
    expect(p.particle).toBe("L");
  });
});
