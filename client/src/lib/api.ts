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

async function unwrap<T>(res: Response, fallbackError: string): Promise<T> {
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? fallbackError);
  return body.data as T;
}

export async function fetchDecks(): Promise<Deck[]> {
  const res = await fetch("/api/decks");
  return unwrap<Deck[]>(res, "Failed to load decks");
}

export async function deleteDeck(id: number): Promise<void> {
  const res = await fetch(`/api/decks/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to delete deck");
  }
}

export async function fetchQueue(deckId?: number, limit = 20): Promise<StudyCard[]> {
  const params = new URLSearchParams();
  if (deckId) params.set("deckId", String(deckId));
  params.set("limit", String(limit));
  const res = await fetch(`/api/study/queue?${params}`);
  return unwrap<StudyCard[]>(res, "Failed to load study queue");
}

export async function reviewCard(cardId: number, rating: 1 | 2 | 3 | 4): Promise<void> {
  const res = await fetch(`/api/study/cards/${cardId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating }),
  });
  await unwrap(res, "Failed to submit review");
}

export async function importApkg(file: File, deckName: string) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("deckName", deckName);
  const res = await fetch("/api/import/apkg", { method: "POST", body: fd });
  return unwrap<any>(res, "Import failed");
}

export interface ImportJob {
  id: number;
  kind: string;
  filename: string;
  status: "queued" | "running" | "done" | "error";
  message?: string | null;
  progress?: number | null;
  total?: number | null;
  cards_created?: number | null;
  result?: string | null;
  error?: string | null;
}

export async function fetchImportJob(jobId: number): Promise<ImportJob> {
  const res = await fetch(`/api/import/jobs/${jobId}`);
  return unwrap<ImportJob>(res, "Failed to load import job");
}

// Textbook import runs as a background job on the server (returns 202 +
// jobId immediately). Poll until it reaches a terminal state so the caller
// gets a real result instead of guessing from the initial response.
export async function importTextbook(
  file: File,
  deckName: string,
  onProgress?: (job: ImportJob) => void
): Promise<{ decks: { id: number; name: string; cards: number }[]; totalCards: number }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("deckName", deckName);
  const res = await fetch("/api/import/textbook", { method: "POST", body: fd });
  const { jobId } = await unwrap<{ jobId: number }>(res, "Import failed");
  const POLL_MS = 500;
  const MAX_WAIT_MS = 5 * 60 * 1000;
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const job = await fetchImportJob(jobId);
    onProgress?.(job);
    if (job.status === "done") {
      return job.result ? JSON.parse(job.result) : { decks: [], totalCards: 0 };
    }
    if (job.status === "error") {
      throw new Error(job.error ?? "Import failed");
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error("Import timed out");
}

export async function fetchNoteAnalysis(noteId: number): Promise<NoteAnalysis[]> {
  const res = await fetch(`/api/notes/${noteId}/analysis`);
  return unwrap<NoteAnalysis[]>(res, "Failed to load note analysis");
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
  deckId?: number;
}
// Back-compat alias for components that referenced the older name.
export type CorrectionPayload = CorrectionInput;

export interface AddNoteInput {
  deckId?: number;
  deckName?: string;
  front: string;
  back: string;
  tags?: string;
}

export async function addNote(input: AddNoteInput): Promise<{ noteId: number; cardId: number; deckId: number }> {
  const res = await fetch("/api/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap(res, "Failed to add card");
}

export async function submitCorrection(input: CorrectionInput): Promise<{ id: number }> {
  const res = await fetch("/api/corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return unwrap(res, "Failed to submit correction");
}
