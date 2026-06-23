// Natural-speech reductions: map a casual spoken form to its canonical form
// while recording each reduction. This is a surface heuristic (clearly labelled
// as such) — both forms are preserved so nothing is silently "corrected".

export interface Reduction {
  label: string;
  from: string;
  to: string;
  note: string;
}

interface Rule {
  re: RegExp;
  to: string;
  label: string;
  note: string;
}

// Order matters: longer / more specific reductions are expanded first.
const RULES: Rule[] = [
  { re: /っていうか/g, to: "というか", label: "というか", note: "casual quotative / topic-shift いうか → っていうか" },
  { re: /っていう/g, to: "という", label: "という", note: "casual quotative という → っていう" },
  { re: /って(?=[、。]|$)/g, to: "という", label: "って (quotative)", note: "って can reduce という / と言って; ambiguous in context" },
  { re: /てんの/g, to: "ているの", label: "〜ているの", note: "casual progressive question: している → してん(の)" },
  { re: /でんの/g, to: "でいるの", label: "〜でいるの", note: "casual progressive question (voiced)" },
  { re: /てる/g, to: "ている", label: "〜ている", note: "progressive contraction ている → てる" },
  { re: /じゃない/g, to: "ではない", label: "ではない", note: "では → じゃ (negative)" },
  { re: /じゃなかった/g, to: "ではなかった", label: "ではなかった", note: "では → じゃ (past negative)" },
  { re: /じゃありません/g, to: "ではありません", label: "ではありません", note: "では → じゃ (polite negative)" },
  { re: /なきゃ/g, to: "なければ", label: "なければ", note: "obligation contraction なければ → なきゃ" },
  { re: /なくちゃ/g, to: "なくては", label: "なくては", note: "obligation contraction なくては → なくちゃ" },
];

export interface ColloquialAnalysis {
  /** The form as spoken/written by the source. */
  spoken: string;
  /** Reconstructed canonical (textbook) form. */
  canonical: string;
  reductions: Reduction[];
  /** Heuristic surface transform — never high confidence on its own. */
  confidence: "medium" | "low";
}

export function canonicalizeSpeech(text: string): ColloquialAnalysis {
  let canonical = text;
  const reductions: Reduction[] = [];

  for (const rule of RULES) {
    if (rule.re.test(canonical)) {
      // Record the reduction with the actual matched fragment, not the whole string.
      const before = canonical;
      const match = before.match(rule.re)?.[0] ?? before;
      canonical = canonical.replace(rule.re, rule.to);
      if (canonical !== before) {
        reductions.push({ label: rule.label, from: match, to: rule.to, note: rule.note });
      }
    }
  }

  return {
    spoken: text,
    canonical,
    reductions,
    confidence: reductions.length ? "medium" : "low",
  };
}

export function hasColloquialReduction(text: string): boolean {
  return canonicalizeSpeech(text).reductions.length > 0;
}
