import type { AnalyzedToken } from "./tokenizer.js";
import { bandOf, type ConfidenceBand, type Evidence } from "./types.js";
import { aspectOf } from "./aspect.js";

export interface GrammarAlternative {
  label: string;
  title: string;
  note: string;
}

export interface GrammarAnnotation {
  /** Canonical machine id, e.g. "te-iru:resultant". Used for grammar search. */
  label: string;
  /** Human-facing title, e.g. "ている (resultant state)". */
  title: string;
  /** Token index range [start, end). */
  span: { start: number; end: number };
  surface: string;
  short: string;
  long: string;
  literal?: string;
  natural?: string;
  confidence: number;
  band: ConfidenceBand;
  alternatives: GrammarAlternative[];
  evidence: Evidence[];
  needsReview: boolean;
}

type Detector = (t: AnalyzedToken[]) => GrammarAnnotation[];

const analyzerEvidence = (detail: string): Evidence => ({
  source: "analyzer",
  detail,
  analyzer: "kuromoji",
  analyzerVersion: "ipadic-0.1.2",
});

function make(
  a: Omit<GrammarAnnotation, "band"> & { band?: ConfidenceBand }
): GrammarAnnotation {
  return { ...a, band: a.band ?? bandOf(a.confidence) };
}

function surfaceOf(tokens: AnalyzedToken[], start: number, end: number): string {
  return tokens.slice(start, end).map((t) => t.surface).join("");
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

interface ParticleInfo {
  title: string;
  short: string;
  long: string;
  alternatives?: GrammarAlternative[];
}

const PARTICLES: Record<string, ParticleInfo> = {
  は: {
    title: "は (topic)",
    short: "Marks the topic / what the sentence is about.",
    long: "は sets the topic and often implies contrast. It is not a grammatical subject marker; the subject may differ from the topic.",
    alternatives: [{ label: "contrast", title: "は (contrastive)", note: "Can mark contrast ('as for X, unlike others')." }],
  },
  が: {
    title: "が (subject)",
    short: "Marks the subject; presents new or exhaustive information.",
    long: "が marks the grammatical subject. With stative predicates (好き, ある, できる, わかる) it can mark the object of liking/ability.",
    alternatives: [{ label: "object-of-stative", title: "が (object of stative)", note: "With 好き/ある/できる/わかる, が marks what is liked/able/understood." }],
  },
  を: {
    title: "を (direct object)",
    short: "Marks the direct object of a transitive verb.",
    long: "を marks the direct object. With motion verbs (通る, 歩く, 出る) it can mark the path or point of departure.",
    alternatives: [{ label: "path", title: "を (path/source)", note: "With 通る/歩く/出る, を marks the route or place left." }],
  },
  に: {
    title: "に (target / location / time)",
    short: "Goal, indirect object, location of existence, or point in time.",
    long: "に has many roles: destination/goal, indirect object (recipient), location of existence (with ある/いる), specific time, or agent in passives. The correct role depends on the predicate.",
    alternatives: [
      { label: "indirect-object", title: "に (indirect object)", note: "Recipient: 友達に渡す." },
      { label: "agent", title: "に (agent)", note: "In passives: 先生に褒められた." },
    ],
  },
  で: {
    title: "で (location of action / means)",
    short: "Place where an action occurs, or means/method/cause.",
    long: "で marks the location of a dynamic action, or the means, material, or cause. Contrast with に (location of existence).",
    alternatives: [{ label: "means", title: "で (means/cause)", note: "By/with: 電車で行く, 風邪で休む." }],
  },
  へ: { title: "へ (direction)", short: "Direction of movement (toward).", long: "へ marks direction; often interchangeable with destination に, but emphasizes the heading rather than the endpoint." },
  と: {
    title: "と (with / and / quotative)",
    short: "Accompaniment, exhaustive listing, or quotation.",
    long: "と joins nouns exhaustively ('and'), marks a partner ('with'), or quotes/contains a clause (…と言う/思う). It can also be a conditional ('whenever/if').",
    alternatives: [{ label: "quotative", title: "と (quotative)", note: "…と言う/思う marks reported content." }, { label: "conditional", title: "と (conditional)", note: "Verb-plain + と = 'whenever/if'." }],
  },
  から: { title: "から (from / because)", short: "Starting point in space/time, or reason.", long: "から marks a source/origin ('from') or, after a clause, a subjective reason ('because')." },
  まで: { title: "まで (until / as far as)", short: "Endpoint or extent in space/time.", long: "まで marks the limit or extent ('up to/until'). With も it means 'even'." },
  より: { title: "より (than / from)", short: "Standard of comparison, or formal 'from'.", long: "より marks the standard in comparisons ('than'), or a formal starting point." },
  へと: { title: "へと", short: "Emphatic direction.", long: "Combination of へ and と stressing movement toward." },
};

const detectParticles: Detector = (tokens) =>
  tokens.flatMap((t, i) => {
    if (t.pos !== "助詞") return [];
    const info = PARTICLES[t.surface];
    if (!info) return [];
    // が/は subject-vs-topic and に's many roles are genuinely context-sensitive.
    const ambiguous = t.surface === "に" || t.surface === "と";
    return [
      make({
        label: `particle:${t.surface}`,
        title: info.title,
        span: { start: i, end: i + 1 },
        surface: t.surface,
        short: info.short,
        long: info.long,
        confidence: ambiguous ? 0.6 : 0.8,
        alternatives: info.alternatives ?? [],
        evidence: [analyzerEvidence(`${t.surface} tagged ${t.pos}/${t.posDetail}`)],
        needsReview: false,
      }),
    ];
  });

// ---------------------------------------------------------------------------
// そう: appearance (様態) vs hearsay (伝聞)
// ---------------------------------------------------------------------------

const detectSou: Detector = (tokens) => {
  const out: GrammarAnnotation[] = [];
  tokens.forEach((t, i) => {
    if (t.surface !== "そう" || t.pos !== "名詞") return;
    const prev = tokens[i - 1];
    if (!prev) return;

    // Appearance: 連用形 verb / adjective stem + そう (接尾). 降りそう, 高そう.
    // Hearsay: plain (基本形/past) + そうだ (特殊). 降るそうだ, 高いそうだ.
    const appearance =
      t.posDetail === "接尾" ||
      prev.conjugationForm === "連用形" ||
      (prev.pos === "形容詞" && prev.conjugationForm === "ガル接続");
    const hearsay = t.posDetail === "特殊" || prev.conjugationForm === "基本形";

    if (appearance && !hearsay) {
      out.push(make({
        label: "sou:appearance",
        title: "そう (様態 — looks like / seems)",
        span: { start: i - 1, end: i + 1 },
        surface: surfaceOf(tokens, i - 1, i + 1),
        short: "Conjecture from appearance: it looks like it will happen.",
        long: "様態の「そう」 attaches to a verb 連用形 (masu-stem) or adjective stem and expresses a judgement from visible signs. 雨が降りそう = 'it looks like it'll rain'.",
        literal: "appears that [stem]…",
        confidence: 0.9,
        alternatives: [{ label: "sou:hearsay", title: "そうだ (伝聞)", note: "If the preceding verb were in plain form (降るそうだ), it would be hearsay instead." }],
        evidence: [analyzerEvidence(`preceding form ${prev.conjugationForm}; そう tagged 名詞/${t.posDetail}`)],
        needsReview: false,
      }));
    } else if (hearsay && !appearance) {
      out.push(make({
        label: "sou:hearsay",
        title: "そうだ (伝聞 — I hear that)",
        span: { start: i - 1, end: i + 1 },
        surface: surfaceOf(tokens, i - 1, i + 1),
        short: "Hearsay: reporting information from another source.",
        long: "伝聞の「そうだ」 attaches to a plain form and reports second-hand information. 雨が降るそうだ = 'I hear it's going to rain'.",
        literal: "I hear that [plain clause]…",
        confidence: 0.9,
        alternatives: [{ label: "sou:appearance", title: "そう (様態)", note: "If the verb were a 連用形 stem (降りそう), it would express appearance instead." }],
        evidence: [analyzerEvidence(`preceding form ${prev.conjugationForm}; そう tagged 名詞/${t.posDetail}`)],
        needsReview: false,
      }));
    } else {
      out.push(make({
        label: "sou:ambiguous",
        title: "そう (ambiguous: appearance or hearsay)",
        span: { start: i - 1, end: i + 1 },
        surface: surfaceOf(tokens, i - 1, i + 1),
        short: "Could be appearance (様態) or hearsay (伝聞).",
        long: "The preceding form is not decisive. 様態 requires a 連用形 stem; 伝聞 requires a plain form. More context is needed.",
        confidence: 0.4,
        alternatives: [
          { label: "sou:appearance", title: "そう (様態)", note: "looks like / seems" },
          { label: "sou:hearsay", title: "そうだ (伝聞)", note: "I hear that" },
        ],
        evidence: [analyzerEvidence(`preceding form ${prev.conjugationForm}; そう tagged 名詞/${t.posDetail}`)],
        needsReview: true,
      }));
    }
  });
  return out;
};

// ---------------------------------------------------------------------------
// て-いる / て-ある / て-しまう
// ---------------------------------------------------------------------------

const detectTeForms: Detector = (tokens) => {
  const out: GrammarAnnotation[] = [];
  tokens.forEach((t, i) => {
    const prev = tokens[i - 1];
    if (!prev || (prev.surface !== "て" && prev.surface !== "で") || prev.pos !== "助詞") return;
    const verb = tokens[i - 2];

    if (t.base === "いる" && t.pos === "動詞") {
      const verbBase = verb?.base ?? "";
      const aspect = aspectOf(verbBase);
      const span = { start: i - 2 < 0 ? i - 1 : i - 2, end: i + 1 };
      const surface = surfaceOf(tokens, span.start, span.end);
      const ev = [analyzerEvidence(`て-form of ${verbBase || "?"} + いる; lexical aspect = ${aspect}`)];

      if (aspect === "durative") {
        out.push(make({ label: "te-iru:progressive", title: "ている (progressive)", span, surface,
          short: "Ongoing action: is/are doing.", long: `${verbBase} is an activity verb, so ている describes an action in progress.`,
          natural: "is ~ing", confidence: 0.8, alternatives: [{ label: "te-iru:resultant", title: "ている (resultant)", note: "Some verbs instead describe a resulting state." }], evidence: ev, needsReview: false }));
      } else if (aspect === "resultative") {
        out.push(make({ label: "te-iru:resultant", title: "ている (resultant state)", span, surface,
          short: "Resulting state after a change: is now ~.", long: `${verbBase} is a change-of-state verb, so ている describes the state resulting from that change (e.g. 開いている = 'is open').`,
          natural: "is (in the state of having ~ed)", confidence: 0.8, alternatives: [{ label: "te-iru:progressive", title: "ている (progressive)", note: "With activity verbs this would be an ongoing action." }], evidence: ev, needsReview: false }));
      } else {
        out.push(make({ label: "te-iru:ambiguous", title: "ている (progressive or resultant)", span, surface,
          short: "Could be an ongoing action or a resulting state.", long: `Whether ている is progressive or resultant depends on the lexical aspect of ${verbBase || "the verb"}, which is not classified here. Both readings are possible.`,
          confidence: 0.4,
          alternatives: [
            { label: "te-iru:progressive", title: "ている (progressive)", note: "is ~ing" },
            { label: "te-iru:resultant", title: "ている (resultant state)", note: "is in the resulting state" },
          ], evidence: ev, needsReview: true }));
      }
    } else if (t.base === "ある" && t.pos === "動詞") {
      const span = { start: i - 2 < 0 ? i - 1 : i - 2, end: i + 1 };
      out.push(make({ label: "te-aru", title: "てある (prepared state)", span, surface: surfaceOf(tokens, span.start, span.end),
        short: "A state resulting from a deliberate, prior action.", long: "てある marks a state that someone intentionally brought about and left in place (transitive verb + てある).",
        confidence: 0.8, alternatives: [], evidence: [analyzerEvidence("て + ある")], needsReview: false }));
    } else if (t.base === "しまう" && t.pos === "動詞") {
      const span = { start: i - 2 < 0 ? i - 1 : i - 2, end: i + 1 };
      out.push(make({ label: "te-shimau", title: "てしまう (completion / regret)", span, surface: surfaceOf(tokens, span.start, span.end),
        short: "Completion, or an unintended/regrettable result.", long: "てしまう marks completion or that something happened regrettably/accidentally (casual: ちゃう/じゃう).",
        confidence: 0.8, alternatives: [], evidence: [analyzerEvidence("て + しまう")], needsReview: false }));
    }
  });
  return out;
};

// ---------------------------------------------------------------------------
// Voice: passive / causative / causative-passive / potential (+ neg/past)
// ---------------------------------------------------------------------------

const detectVoice: Detector = (tokens) => {
  const causativeIdx = tokens.findIndex((t) => t.base === "せる" || t.base === "させる");
  const passiveIdx = tokens.findIndex((t) => t.base === "れる" || t.base === "られる");
  if (causativeIdx === -1 && passiveIdx === -1) return [];

  const negative = tokens.some((t) => t.base === "ない");
  const past = tokens.some((t) => t.base === "た");
  const verb = tokens.find((t) => t.pos === "動詞" && t.posDetail === "自立");
  const start = tokens.indexOf(verb ?? tokens[0]);
  const end = Math.max(causativeIdx, passiveIdx) + 1;
  const span = { start: Math.max(0, start), end };
  const surface = surfaceOf(tokens, span.start, span.end);
  const suffix = `${negative ? ", negative" : ""}${past ? ", past" : ""}`;
  const ev = [analyzerEvidence(`auxiliary chain: ${tokens.filter((t) => t.pos === "助動詞" || t.posDetail === "接尾").map((t) => t.base).join("→")}`)];

  if (causativeIdx !== -1 && passiveIdx !== -1 && passiveIdx > causativeIdx) {
    return [make({ label: "voice:causative-passive", title: `causative-passive${suffix}`, span, surface,
      short: "Was made/forced to do (and affected by it).", long: "Causative (せる/させる) + passive (られる): the subject was made to do something by someone, framed as undergoing it. 食べさせられる = 'to be made to eat'.",
      literal: "be-made-to + [verb]" + suffix, confidence: 0.85, alternatives: [], evidence: ev, needsReview: false })];
  }
  if (causativeIdx !== -1) {
    return [make({ label: "voice:causative", title: `causative${suffix}`, span, surface,
      short: "Make/let someone do.", long: "Causative (せる/させる): the subject makes or lets someone do the action.",
      confidence: 0.85, alternatives: [], evidence: ev, needsReview: false })];
  }
  // passive-only られる is structurally ambiguous (passive/potential/honorific/spontaneous).
  return [make({ label: "voice:passive-or-potential", title: `passive / potential / honorific${suffix}`, span, surface,
    short: "られる has several functions; context decides.", long: "Standalone られる can be passive ('be ~ed'), potential ('can ~'), honorific, or spontaneous. The right reading depends on context (agent marking with に/から suggests passive; an object with が suggests potential).",
    confidence: 0.45,
    alternatives: [
      { label: "voice:passive", title: "passive", note: "be ~ed (agent marked by に/から)" },
      { label: "voice:potential", title: "potential", note: "can ~ (often with が)" },
      { label: "voice:honorific", title: "honorific", note: "respectful form of the verb" },
    ], evidence: ev, needsReview: true })];
};

// ---------------------------------------------------------------------------
// Fixed patterns: obligation / わけ / こと / purpose
// ---------------------------------------------------------------------------

function findSubsequence(tokens: AnalyzedToken[], preds: ((t: AnalyzedToken) => boolean)[]): number {
  // Returns start index where preds match consecutive tokens, or -1.
  for (let i = 0; i + preds.length <= tokens.length; i++) {
    if (preds.every((p, k) => p(tokens[i + k]))) return i;
  }
  return -1;
}

const detectFixed: Detector = (tokens) => {
  const out: GrammarAnnotation[] = [];
  const sur = (t: AnalyzedToken) => t.surface;

  // なければならない / なくてはいけない / なきゃ(ならない) — obligation
  const naIdx = tokens.findIndex((t) => t.surface === "なけれ" || t.surface === "なく");
  if (naIdx !== -1) {
    const tail = tokens.slice(naIdx).map(sur).join("");
    if (/(なけれ|なく)(ては|れば|.?)?(なら|いけ|だめ|いか)/.test(tail) || tail.startsWith("なけれ")) {
      out.push(make({ label: "obligation:nakereba-naranai", title: "なければならない (obligation)", span: { start: naIdx, end: tokens.length },
        surface: surfaceOf(tokens, naIdx, tokens.length), short: "Must / have to do.", long: "Double negative 'if not do, won't do' = obligation. なければならない / なくてはいけない (casual なきゃ/なくちゃ).",
        literal: "if-not-do, it-won't-do", confidence: 0.85, alternatives: [], evidence: [analyzerEvidence("なけれ/なく … なら/いけ pattern")], needsReview: false }));
    }
  }

  // わけ + で/だ + は + ない = わけではない
  const wakeIdx = tokens.findIndex((t) => t.surface === "わけ");
  if (wakeIdx !== -1) {
    const after = tokens.slice(wakeIdx).map(sur).join("");
    if (after.startsWith("わけではない") || after.startsWith("わけじゃない")) {
      out.push(make({ label: "wake-dewa-nai", title: "わけではない (it's not that…)", span: { start: wakeIdx, end: tokens.length },
        surface: surfaceOf(tokens, wakeIdx, tokens.length), short: "Partial negation: it's not (necessarily) the case that…", long: "わけではない softly denies a conclusion one might draw; it does NOT mean a total denial. 行くわけではない = 'it's not that I'm (definitely) going'.",
        confidence: 0.85, alternatives: [{ label: "wake-ga-nai", title: "わけがない", note: "わけがない = 'there's no way that…' (stronger impossibility)." }], evidence: [analyzerEvidence("わけ + で + は + ない")], needsReview: false }));
    } else if (after.startsWith("わけがない")) {
      out.push(make({ label: "wake-ga-nai", title: "わけがない (no way that…)", span: { start: wakeIdx, end: tokens.length },
        surface: surfaceOf(tokens, wakeIdx, tokens.length), short: "Strong denial: there's no way that…", long: "わけがない expresses that something is impossible or highly unlikely.",
        confidence: 0.85, alternatives: [], evidence: [analyzerEvidence("わけ + が + ない")], needsReview: false }));
    }
  }

  // こと + に + なる/する
  const kotoIdx = findSubsequence(tokens, [(t) => t.surface === "こと", (t) => t.surface === "に", (t) => t.base === "なる" || t.base === "する"]);
  if (kotoIdx !== -1) {
    const verb = tokens[kotoIdx + 2];
    if (verb.base === "なる") {
      out.push(make({ label: "koto-ni-naru", title: "ことになる (it's been decided / turns out)", span: { start: kotoIdx, end: kotoIdx + 3 },
        surface: surfaceOf(tokens, kotoIdx, kotoIdx + 3), short: "An outcome/decision reached (often by others/circumstance).", long: "ことになる presents a decision or result as something that came about, not necessarily by the speaker's own will. 行くことになった = 'it's been decided that I'll go'.",
        confidence: 0.85, alternatives: [{ label: "koto-ni-suru", title: "ことにする", note: "ことにする = the speaker decides to do it (own volition)." }], evidence: [analyzerEvidence("こと + に + なる")], needsReview: false }));
    } else {
      out.push(make({ label: "koto-ni-suru", title: "ことにする (decide to)", span: { start: kotoIdx, end: kotoIdx + 3 },
        surface: surfaceOf(tokens, kotoIdx, kotoIdx + 3), short: "The speaker decides to do something.", long: "ことにする marks a deliberate decision by the speaker.",
        confidence: 0.85, alternatives: [{ label: "koto-ni-naru", title: "ことになる", note: "ことになる = decided by circumstance/others." }], evidence: [analyzerEvidence("こと + に + する")], needsReview: false }));
    }
  }

  // ため + に  /  よう + に  (purpose)
  tokens.forEach((t, i) => {
    const next = tokens[i + 1];
    if (t.surface === "ため" && next?.surface === "に") {
      const prev = tokens[i - 1];
      out.push(make({ label: "purpose:tame-ni", title: "ために (purpose — volitional)", span: { start: Math.max(0, i - 1), end: i + 2 },
        surface: surfaceOf(tokens, Math.max(0, i - 1), i + 2), short: "In order to (deliberate goal).", long: "ために expresses a purpose the subject deliberately pursues, typically after a volitional plain verb or noun+の. Contrast ように (non-volitional/ability).",
        confidence: 0.8, alternatives: [{ label: "purpose:tame-cause", title: "ため (cause)", note: "After a state/plain clause ために can also mean 'because of'." }],
        evidence: [analyzerEvidence(`ため + に; preceding verb ${prev?.base ?? "?"}`)], needsReview: false }));
    }
    if (t.surface === "よう" && next?.surface === "に" && t.pos === "名詞") {
      const prev = tokens[i - 1];
      out.push(make({ label: "purpose:you-ni", title: "ように (purpose — non-volitional / ability)", span: { start: Math.max(0, i - 1), end: i + 2 },
        surface: surfaceOf(tokens, Math.max(0, i - 1), i + 2), short: "So that (a state/ability is reached).", long: "ように expresses a goal that is a state or ability rather than a direct volitional act — typically after a potential verb (行ける) or a negative. 行けるように = 'so that (I) can go'.",
        confidence: 0.8, alternatives: [{ label: "you:comparison", title: "ように (like/as)", note: "ように can also mean 'like/as' (similarity) in other contexts." }],
        evidence: [analyzerEvidence(`よう + に; preceding verb ${prev?.base ?? "?"}`)], needsReview: false }));
    }
  });

  return out;
};

const DETECTORS: Detector[] = [
  detectParticles,
  detectSou,
  detectTeForms,
  detectVoice,
  detectFixed,
];

/** Run all grammar detectors and return annotations ordered by position. */
export function analyzeGrammar(tokens: AnalyzedToken[]): GrammarAnnotation[] {
  const annotations = DETECTORS.flatMap((d) => d(tokens));
  return annotations.sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);
}
