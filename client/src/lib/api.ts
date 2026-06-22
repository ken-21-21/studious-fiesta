export interface Deck {
  id: number;
  name: string;
  created_at: string;
  card_count: number;
  due_count: number;
}

export interface Provenance {
  sourceId: number;
  kind: string;
  filename: string;
  location?: any;
}

export interface FuriganaSegment {
  text: string;
  reading?: string;
  uncertain?: boolean;
}

export interface PitchInfo {
  accent: number;
  type: string;
  pattern: ("H" | "L")[];
  particle: "H" | "L";
  morae: string[];
}

interface JpFields {
  furigana?: FuriganaSegment[];
  reading?: string;
  readingUncertain?: boolean;
  readingAlternatives?: string[];
  morae?: string[];
  pitch?: PitchInfo;
  lang?: "ja" | "en";
  prompt?: string;
}

export type StudyCard = {
  id: number;
  note_id: number;
  deck_id: number;
  media: { image?: string; audio?: string };
  noteFields: Record<string, string>;
  provenance?: Provenance;
} & (
  | { card_type: "basic"; question: { text: string }; answer: { text: string } }
  | { card_type: "cloze"; question: { text: string }; answer: { text: string } }
  | { card_type: "listening"; question: { tts: string } & JpFields; answer: { text: string } & JpFields }
  | { card_type: "scramble"; question: { words: string[] }; answer: { words: string[] } }
  | { card_type: "vocab"; question: { text: string } & JpFields; answer: { text: string } & JpFields }
  | { card_type: "pitch"; question: { text: string } & JpFields; answer: { pitch: PitchInfo } }
);

export interface NoteAnalysis {
  kind: "reading" | "grammar";
  surface: string;
  label: string;
  span?: { start: number; end: number };
  confidence: number;
  band: "high" | "medium" | "low";
  needsReview: boolean;
  analyzer?: { name: string; version: string };
  evidence: any;
  alternatives: any;
  payload: any;
  correctedByUser: boolean;
  createdAt: string;
}

export async function fetchDecks(): Promise<Deck[]> {
  const res = await fetch("/api/decks");
  if (!res.ok) throw new Error("Failed to load decks");
  return res.json();
}

export async function deleteDeck(id: number): Promise<void> {
  const res = await fetch(`/api/decks/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete deck");
}

export async function fetchQueue(deckId?: number, limit = 20): Promise<StudyCard[]> {
  const params = new URLSearchParams();
  if (deckId) params.set("deckId", String(deckId));
  params.set("limit", String(limit));
  const res = await fetch(`/api/study/queue?${params}`);
  if (!res.ok) throw new Error("Failed to load study queue");
  return res.json();
}

export async function reviewCard(cardId: number, rating: 1 | 2 | 3 | 4): Promise<void> {
  const res = await fetch(`/api/study/cards/${cardId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating }),
  });
  if (!res.ok) throw new Error("Failed to submit review");
}

export async function importApkg(file: File, deckName: string) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("deckName", deckName);
  const res = await fetch("/api/import/apkg", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Import failed");
  return data;
}

export async function importTextbook(file: File, deckName: string) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("deckName", deckName);
  const res = await fetch("/api/import/textbook", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Import failed");
  return data;
}

export async function fetchNoteAnalysis(noteId: number): Promise<NoteAnalysis[]> {
  const res = await fetch(`/api/notes/${noteId}/analysis`);
  if (!res.ok) throw new Error("Failed to load note analysis");
  return res.json();
}

export type CorrectionKind =
  | "reading" | "tokenization" | "grammar" | "pitch" | "ocr" | "asr" | "translation" | "field_mapping";
export type CorrectionScope = "occurrence" | "sentence" | "source" | "deck" | "matching" | "global";

export interface CorrectionInput {
  kind: CorrectionKind;
  surface?: string;
  context?: string;
  scope?: CorrectionScope;
  value: string;
  note?: string;
  sourceId?: number;
}

export async function submitCorrection(input: CorrectionInput): Promise<{ id: number }> {
  const res = await fetch("/api/corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to submit correction");
  return data;
}
