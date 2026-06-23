// ---------------------------------------------------------------------------
// Auth token management
// ---------------------------------------------------------------------------

const SESSION_KEY = "fsrs_session_token";

export function getSessionToken(): string | null {
    return localStorage.getItem(SESSION_KEY);
}

export function setSessionToken(token: string) {
    localStorage.setItem(SESSION_KEY, token);
}

export function clearSessionToken() {
    localStorage.removeItem(SESSION_KEY);
}

/** Build fetch headers that include the session token when available. */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
    const token = getSessionToken();
    return {
          ...(token ? { "x-session-token": token } : {}),
          ...extra,
    };
}

/** Authenticated fetch — drops token and reloads on 401. */
async function apiFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
    const res = await fetch(input, {
          ...init,
          headers: {
                  ...authHeaders(init?.headers as Record<string, string>),
          },
    });
    if (res.status === 401) {
          clearSessionToken();
          window.location.href = "/login";
    }
    return res;
}

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

export async function login(username: string, password: string): Promise<void> {
    const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
    });
    const body = await res.json();
    if (!res.ok || body.error) {
          throw new Error(body.error || "Login failed");
    }
    setSessionToken(body.data.token);
}

export async function logout(): Promise<void> {
    await apiFetch("/api/auth/logout", { method: "POST" });
    clearSessionToken();
}

export async function checkAuth(): Promise<boolean> {
    try {
          const res = await apiFetch("/api/auth/check");
          const body = await res.json();
          return body?.data?.authenticated === true;
    } catch {
          return false;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ApiEnvelope<T> {
    data: T;
    error: string | null;
}

async function parseEnvelope<T>(res: Response): Promise<ApiEnvelope<T>> {
    let body: unknown;
    try {
          body = await res.json();
    } catch {
          throw new Error(`HTTP ${res.status}`);
    }
    if (!body || typeof body !== "object") throw new Error("Invalid server response");
    const envelope = body as Partial<ApiEnvelope<T>>;
    return {
          data: envelope.data as T,
          error: typeof envelope.error === "string" ? envelope.error : null,
    };
}

async function unwrap<T>(res: Response, fallbackError: string): Promise<T> {
    const body = await parseEnvelope<T>(res);
    if (body.error) throw new Error(body.error || fallbackError);
    return body.data;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
    location: unknown;
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
    media?: { image?: string; audio?: string };
    noteFields: Record<string, string>;
    provenance: Provenance;
} & (
    | { card_type: "basic"; question: { text: string }; answer: { text: string } }
  | { card_type: "cloze"; question: { text: string } & JpFields; answer: { text: string } & JpFields }
  | { card_type: "listening"; question: { tts: string } & JpFields; answer: { text: string } & JpFields }
  | { card_type: "scramble"; question: { words: string[]; lang: "ja" | "en" }; answer: { words: string[]; reading?: string; readingUncertain?: boolean; wordFurigana?: FuriganaSegment[] } }
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
    evidence: unknown;
    alternatives: unknown;
    payload: unknown;
    correctedByUser?: boolean;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// API functions (now use apiFetch for auth)
// ---------------------------------------------------------------------------

export async function fetchDecks(): Promise<Deck[]> {
    const res = await apiFetch("/api/decks");
    return unwrap<Deck[]>(res, "Failed to load decks");
}

export async function deleteDeck(id: number): Promise<void> {
    const res = await apiFetch(`/api/decks/${id}`, { method: "DELETE" });
    if (!res.ok) {
          let message = "Failed to delete deck";
          try {
                  const body = await parseEnvelope<null>(res);
                  message = body.error || message;
          } catch {
                  // Keep default message for non-JSON/non-envelope errors.
          }
          throw new Error(message);
    }
}

export async function fetchQueue(deckId: number, limit?: number): Promise<StudyCard[]> {
    const params = new URLSearchParams();
    params.set("deckId", String(deckId));
    params.set("limit", String(limit));
    const res = await apiFetch(`/api/study/queue?${params}`);
    return unwrap<StudyCard[]>(res, "Failed to load study queue");
}

export async function reviewCard(cardId: number, rating: number): Promise<void> {
    const res = await apiFetch(`/api/study/cards/${cardId}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating }),
    });
    await unwrap<void>(res, "Failed to submit review");
}

export async function importApkg(file: File, deckName: string) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("deckName", deckName);
    const res = await apiFetch("/api/import/apkg", { method: "POST", body: fd });
    return unwrap<{ cardsImported: number }>(res, "Import failed");
}

export interface ImportJob {
    id: number;
    kind: string;
    filename: string;
    status: "queued" | "running" | "done" | "error";
    message: string | null;
    progress: number | null;
    total: number | null;
    cards_created: number | null;
    result: string | null;
    error: string | null;
}

export async function fetchImportJob(jobId: number): Promise<ImportJob> {
    const res = await apiFetch(`/api/import/jobs/${jobId}`);
    return unwrap<ImportJob>(res, "Failed to load import job");
}

export async function importTextbook(
    file: File,
    deckName: string,
    onProgress?: (job: ImportJob) => void
  ): Promise<{ decks: { id: number; name: string; cards: number }[]; totalCards: number }> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("deckName", deckName);
    const res = await apiFetch("/api/import/textbook", { method: "POST", body: fd });
    const { jobId }: { jobId: number } = await unwrap(res, "Import failed");
    const POLL_MS = 500;
    const MAX_WAIT_MS = 1000 * 60 * 10;
    const start = Date.now();
    while (Date.now() - start < MAX_WAIT_MS) {
          const job = await fetchImportJob(jobId);
          onProgress?.(job);
          if (job.status === "done") {
                  try {
                            return JSON.parse(job.result!) as { decks: { id: number; name: string; cards: number }[]; totalCards: number };
                  } catch {
                            throw new Error("Import returned malformed result data");
                  }
          }
          if (job.status === "error") throw new Error(job.error ?? "Import failed");
          await new Promise((r) => setTimeout(r, POLL_MS));
    }
    throw new Error("Import timed out");
}

export async function fetchNoteAnalysis(noteId: number): Promise<NoteAnalysis[]> {
    const res = await apiFetch(`/api/notes/${noteId}/analysis`);
    return unwrap<NoteAnalysis[]>(res, "Failed to load note analysis");
}

export type CorrectionKind = "reading" | "tokenization" | "grammar" | "pitch" | "ocr" | "asr" | "translation" | "field_mapping";
export type CorrectionScope = "occurrence" | "sentence" | "source" | "deck" | "matching" | "global";

export interface CorrectionInput {
    kind: CorrectionKind;
    surface: string;
    context: string;
    scope: CorrectionScope;
    value: string;
    note?: string;
    sourceId?: number;
    deckId?: number;
}

// Back-compat alias for components that referenced the older name.
export type CorrectionPayload = CorrectionInput;

export interface AddNoteInput {
    deckId: number;
    deckName: string;
    front: string;
    back: string;
    tags?: string[];
}

export async function addNote(input: AddNoteInput): Promise<{ noteId: number; cardId: number; deckId: number }> {
    const res = await apiFetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
    });
    return unwrap(res, "Failed to add card");
}

export async function submitCorrection(input: CorrectionInput): Promise<number> {
    const res = await apiFetch("/api/corrections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
    });
    return unwrap(res, "Failed to submit correction");
}
