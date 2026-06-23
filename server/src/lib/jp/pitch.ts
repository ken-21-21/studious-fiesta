import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../../db/index.js";
import { splitMorae } from "./morae.js";
import { kataToHira, hasKana, hasKanji } from "./kana.js";

// Public kanjium pitch-accent dataset (word, reading, downstep mora positions).
const DATASET_URL =
  "https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/accents.txt";
const DATASET_PATH = path.join(DATA_DIR, "accents.txt");

export interface PitchEntry {
  reading: string; // hiragana
  accents: number[]; // downstep mora index; 0 = heiban (flat)
}

export type AccentType = "heiban" | "atamadaka" | "nakadaka" | "odaka";

export interface PitchInfo {
  accent: number;
  type: AccentType;
  /** Per-mora High/Low pattern, e.g. ["L","H","H"]. */
  pattern: ("H" | "L")[];
  /** High/Low of a following particle (helps distinguish heiban vs odaka). */
  particle: "H" | "L";
  morae: string[];
}

let index: Map<string, PitchEntry[]> | null = null;
let loadPromise: Promise<void> | null = null;
let downloadPromise: Promise<boolean> | null = null;
// If the dataset can't be obtained (e.g. a transient network blip), back off
// instead of either hammering every word lookup with a fresh download attempt
// or disabling pitch lookups forever for the rest of the process lifetime.
const RETRY_COOLDOWN_MS = 60_000;
let retryAfter = 0;

export function isPitchDataPresent(): boolean {
  return fs.existsSync(DATASET_PATH) && fs.statSync(DATASET_PATH).size > 0;
}

/** Download the dataset into the data dir if it isn't already there. */
export async function ensurePitchData(): Promise<boolean> {
  if (isPitchDataPresent()) return true;
  if (!downloadPromise) {
    downloadPromise = (async () => {
      const res = await fetch(DATASET_URL);
      if (!res.ok) throw new Error(`Failed to download pitch dataset (HTTP ${res.status})`);
      const text = await res.text();
      fs.mkdirSync(path.dirname(DATASET_PATH), { recursive: true });
      // Write atomically so a partial download can't be mistaken for complete data.
      const tmp = `${DATASET_PATH}.tmp`;
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, DATASET_PATH);
      return true;
    })().catch((err) => {
      downloadPromise = null; // allow retry on next import
      throw err;
    });
  }
  return downloadPromise;
}

async function load(): Promise<void> {
  if (index) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      await ensurePitchData();
      const text = fs.readFileSync(DATASET_PATH, "utf-8");
      const map = new Map<string, PitchEntry[]>();
      for (const line of text.split("\n")) {
        if (!line) continue;
        const [word, readingField, accentField] = line.split("\t");
        if (!word || !accentField) continue;
        // Katakana headwords (コーヒー) carry an empty reading column — the word
        // itself is the reading, so derive it from the kana word.
        let reading = readingField;
        if (!reading) {
          if (hasKana(word) && !hasKanji(word)) reading = word;
          else continue;
        }
        const accents = accentField
          .split(",")
          .map((a) => Number(a.trim()))
          .filter((a) => Number.isFinite(a));
        if (!accents.length) continue;
        const entry: PitchEntry = { reading: kataToHira(reading), accents };
        const list = map.get(word);
        if (list) list.push(entry);
        else map.set(word, [entry]);
      }
      index = map;
    })().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  return loadPromise;
}

function classify(accent: number, moraCount: number): AccentType {
  if (accent === 0) return "heiban";
  if (accent === 1) return "atamadaka";
  if (accent >= moraCount) return "odaka";
  return "nakadaka";
}

/** Build the per-mora H/L contour for a given downstep position (Tokyo dialect). */
export function buildPattern(accent: number, morae: string[]): PitchInfo {
  const m = morae.length;
  const pattern: ("H" | "L")[] = [];
  for (let i = 1; i <= m; i++) {
    if (accent === 0) pattern.push(i === 1 ? "L" : "H");
    else if (accent === 1) pattern.push(i === 1 ? "H" : "L");
    else pattern.push(i === 1 ? "L" : i <= accent ? "H" : "L");
  }
  const particle: "H" | "L" = accent === 0 ? "H" : "L";
  return { accent, type: classify(accent, m), pattern, particle, morae };
}

/**
 * Look up pitch accent for a word. `base` is the dictionary form (may contain
 * kanji); `reading` is its hiragana reading (used to disambiguate homographs).
 */
export async function lookupPitch(base: string, reading: string | null): Promise<PitchInfo | null> {
  if (Date.now() < retryAfter) return null;
  try {
    await load();
  } catch {
    retryAfter = Date.now() + RETRY_COOLDOWN_MS;
    return null;
  }
  const candidates = index!.get(base);
  if (!candidates || !candidates.length) return null;

  const hira = reading ? kataToHira(reading) : null;
  // When a reading is supplied but doesn't match any candidate for this
  // headword, the headword is a homograph and we don't know which entry's
  // pitch accent actually belongs to the caller's reading — presenting a
  // different homograph's pattern as if it matched would silently teach the
  // wrong pitch accent. Only fall back to the first (most common) candidate
  // when no reading was supplied at all to disambiguate against.
  const match = hira ? candidates.find((c) => c.reading === hira) : candidates[0];
  if (!match) return null;
  const morae = splitMorae(match.reading);
  if (!morae.length) return null;
  return buildPattern(match.accents[0], morae);
}
