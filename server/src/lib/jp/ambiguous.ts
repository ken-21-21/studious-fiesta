// Knowledge base of spellings whose reading is genuinely context-sensitive.
// For these, a morphological analyzer's single guess must NOT be silently
// trusted. When no reading dominates everyday usage, the form is flagged for
// review and every alternative is preserved.

export interface AmbiguousReading {
  reading: string; // hiragana
  note: string;
}

export interface AmbiguousEntry {
  surface: string;
  readings: AmbiguousReading[];
  /**
   * The reading that overwhelmingly dominates ordinary text, if one does.
   * When absent, the form is treated as genuinely ambiguous (needs review).
   */
  dominant?: string;
}

const ENTRIES: AmbiguousEntry[] = [
  {
    surface: "今日",
    dominant: "きょう",
    readings: [
      { reading: "きょう", note: "today (everyday)" },
      { reading: "こんにち", note: "nowadays; in 今日は / formal speech" },
    ],
  },
  {
    surface: "生物",
    readings: [
      { reading: "せいぶつ", note: "living thing; biology" },
      { reading: "なまもの", note: "raw / perishable food" },
    ],
  },
  {
    surface: "人気",
    readings: [
      { reading: "にんき", note: "popularity" },
      { reading: "ひとけ", note: "sign of human presence" },
    ],
  },
  {
    surface: "一人",
    dominant: "ひとり",
    readings: [
      { reading: "ひとり", note: "one person; alone" },
      { reading: "いちにん", note: "one person (formal/counting, e.g. 一人前)" },
    ],
  },
  {
    surface: "上手",
    readings: [
      { reading: "じょうず", note: "skilled" },
      { reading: "うわて", note: "upper hand; superior" },
      { reading: "かみて", note: "upstage; stage left from audience" },
    ],
  },
  {
    surface: "開く",
    readings: [
      { reading: "あく", note: "to open (intransitive)" },
      { reading: "ひらく", note: "to open / unfold (trans. or intrans.)" },
    ],
  },
  {
    surface: "行った",
    dominant: "いった",
    readings: [
      { reading: "いった", note: "went (行く past)" },
      { reading: "おこなった", note: "carried out (行う past)" },
    ],
  },
  {
    surface: "辛い",
    readings: [
      { reading: "からい", note: "spicy" },
      { reading: "つらい", note: "painful / hard to bear" },
    ],
  },
  {
    surface: "明日",
    dominant: "あした",
    readings: [
      { reading: "あした", note: "tomorrow (everyday)" },
      { reading: "あす", note: "tomorrow (slightly formal)" },
      { reading: "みょうにち", note: "tomorrow (formal/business)" },
    ],
  },
  {
    surface: "大人気",
    readings: [
      { reading: "だいにんき", note: "very popular (大+人気)" },
      { reading: "おとなげ", note: "maturity; adult-ness (大人+気), as in 大人気ない" },
    ],
  },
  {
    surface: "角",
    readings: [
      { reading: "かど", note: "corner (street, etc.)" },
      { reading: "つの", note: "horn / antler" },
    ],
  },
  {
    surface: "十分",
    dominant: "じゅうぶん",
    readings: [
      { reading: "じゅうぶん", note: "enough / sufficient" },
      { reading: "じゅっぷん", note: "10 minutes" },
      { reading: "じっぷん", note: "10 minutes (classical/formal)" },
    ],
  },
  {
    surface: "空く",
    readings: [
      { reading: "あく", note: "to be open / empty" },
      { reading: "すく", note: "to become less crowded / empty (stomach)" },
    ],
  },
  {
    surface: "弾く",
    readings: [
      { reading: "ひく", note: "to play (a stringed instrument)" },
      { reading: "はじく", note: "to flick / repel" },
    ],
  },
  {
    surface: "怒る",
    dominant: "おこる",
    readings: [
      { reading: "おこる", note: "to get angry (everyday)" },
      { reading: "いかる", note: "to get angry (formal/literary)" },
    ],
  },
  {
    surface: "何か",
    dominant: "なにか",
    readings: [
      { reading: "なにか", note: "something" },
      { reading: "なんか", note: "things like... / somehow" },
    ],
  },
  {
    surface: "下手",
    readings: [
      { reading: "へた", note: "unskillful" },
      { reading: "したて", note: "humble position / subordinate" },
      { reading: "しもて", note: "downstage" },
    ],
  },
  {
    surface: "開ける",
    dominant: "あける",
    readings: [
      { reading: "あける", note: "to open (transitive)" },
      { reading: "ひらける", note: "to become civilized / open up" },
    ],
  },
];

const BY_SURFACE = new Map(ENTRIES.map((e) => [e.surface, e]));

export function lookupAmbiguous(surface: string): AmbiguousEntry | null {
  return BY_SURFACE.get(surface) ?? null;
}

export function isAmbiguousSurface(surface: string): boolean {
  return BY_SURFACE.has(surface);
}

export function allAmbiguousEntries(): readonly AmbiguousEntry[] {
  return ENTRIES;
}
