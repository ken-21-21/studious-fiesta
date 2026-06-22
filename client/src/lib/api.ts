export interface Deck {
  id: number;
  name: string;
  created_at: string;
  card_count: number;
  due_count: number;
}

export interface StudyCard {
  id: number;
  note_id: number;
  deck_id: number;
  card_type: "basic" | "cloze" | "listening" | "scramble";
  question: any;
  answer: any;
  media: { image?: string; audio?: string };
  noteFields: Record<string, string>;
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
