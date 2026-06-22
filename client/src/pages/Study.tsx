import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { fetchQueue, reviewCard, type StudyCard } from "../lib/api";
import StudyCardView from "../components/StudyCard";

export default function Study() {
  const [params] = useSearchParams();
  const deckId = params.get("deckId") ? Number(params.get("deckId")) : undefined;
  const [queue, setQueue] = useState<StudyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewed, setReviewed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchQueue(deckId, 30)
      .then(setQueue)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [deckId]);

  const handleRate = async (rating: 1 | 2 | 3 | 4) => {
    const [current, ...rest] = queue;
    if (!current) return;
    try {
      await reviewCard(current.id, rating);
      setQueue(rest);
      setReviewed((n) => n + 1);
    } catch (err: any) {
      setError(err.message ?? "Failed to submit review");
    }
  };

  if (loading) return <p>Loading...</p>;

  if (error) {
    return (
      <div>
        <p style={{ color: "#dc2626" }}>{error}</p>
        <button onClick={load}>Retry</button>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div>
        <h2>All caught up</h2>
        <p>{reviewed > 0 ? `Reviewed ${reviewed} cards. ` : ""}No cards due right now.</p>
        <Link to="/">Back to decks</Link>
      </div>
    );
  }

  const current = queue[0];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <Link to="/">← Decks</Link>
        <span>{queue.length} remaining</span>
      </div>
      <StudyCardView card={current} onRate={handleRate} />
    </div>
  );
}
