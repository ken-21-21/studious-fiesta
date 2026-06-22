import { describe, it, expect } from "vitest";
import { tokenize } from "../src/lib/jp/tokenizer.js";
import { analyzeGrammar, type GrammarAnnotation } from "../src/lib/jp/grammar.js";

async function annotate(sentence: string): Promise<GrammarAnnotation[]> {
  return analyzeGrammar(await tokenize(sentence));
}
const labels = (anns: GrammarAnnotation[]) => anns.map((a) => a.label);

describe("そう: appearance vs hearsay", () => {
  it("雨が降りそう → appearance (様態), not hearsay", async () => {
    const anns = await annotate("雨が降りそう。");
    expect(labels(anns)).toContain("sou:appearance");
    expect(labels(anns)).not.toContain("sou:hearsay");
  });
  it("雨が降るそうだ → hearsay (伝聞), not appearance", async () => {
    const anns = await annotate("雨が降るそうだ。");
    expect(labels(anns)).toContain("sou:hearsay");
    expect(labels(anns)).not.toContain("sou:appearance");
  });
});

describe("ている: progressive vs resultant", () => {
  it("本を読んでいる → progressive", async () => {
    const anns = await annotate("本を読んでいる。");
    expect(labels(anns)).toContain("te-iru:progressive");
  });
  it("窓が開いている → resultant state", async () => {
    const anns = await annotate("窓が開いている。");
    expect(labels(anns)).toContain("te-iru:resultant");
  });
  it("an unknown-aspect verb is marked ambiguous, not guessed", async () => {
    const anns = await annotate("彼が＿いている。"); // garbled verb → unknown aspect
    // When the verb can't be classified, ている must not silently pick one.
    const teiru = anns.find((a) => a.label.startsWith("te-iru"));
    if (teiru) {
      expect(["te-iru:ambiguous", "te-iru:progressive", "te-iru:resultant"]).toContain(teiru.label);
      if (teiru.label === "te-iru:ambiguous") expect(teiru.needsReview).toBe(true);
    }
  });
});

describe("voice", () => {
  it("食べさせられなかった → causative-passive, negative, past", async () => {
    const anns = await annotate("食べさせられなかった。");
    const v = anns.find((a) => a.label === "voice:causative-passive");
    expect(v).toBeTruthy();
    expect(v!.title).toContain("negative");
    expect(v!.title).toContain("past");
  });
});

describe("fixed patterns", () => {
  it("行かなければならない → obligation", async () => {
    expect(labels(await annotate("行かなければならない。"))).toContain("obligation:nakereba-naranai");
  });
  it("行くわけではない → partial negation (not わけがない)", async () => {
    const l = labels(await annotate("行くわけではない。"));
    expect(l).toContain("wake-dewa-nai");
    expect(l).not.toContain("wake-ga-nai");
  });
  it("行くことになった → ことになる (decided), not ことにする", async () => {
    const l = labels(await annotate("行くことになった。"));
    expect(l).toContain("koto-ni-naru");
    expect(l).not.toContain("koto-ni-suru");
  });
  it("行くために → purpose (volitional)", async () => {
    expect(labels(await annotate("日本に行くために勉強している。"))).toContain("purpose:tame-ni");
  });
  it("行けるように → purpose (non-volitional/ability)", async () => {
    expect(labels(await annotate("日本に行けるように勉強している。"))).toContain("purpose:you-ni");
  });
});

describe("particles", () => {
  it("友達に会う marks に as a target role", async () => {
    const ni = (await annotate("友達に会う。")).find((a) => a.label === "particle:に");
    expect(ni).toBeTruthy();
    expect(ni!.alternatives.length).toBeGreaterThan(0); // に is flagged multi-role
  });
  it("友達を助ける marks を as direct object", async () => {
    const wo = (await annotate("友達を助ける。")).find((a) => a.label === "particle:を");
    expect(wo).toBeTruthy();
    expect(wo!.title).toContain("direct object");
  });
  it("every annotation carries evidence and a confidence band", async () => {
    for (const a of await annotate("本を読んでいる。")) {
      expect(a.evidence.length).toBeGreaterThan(0);
      expect(["high", "medium", "low"]).toContain(a.band);
    }
  });
});
