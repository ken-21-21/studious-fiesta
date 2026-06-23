import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { fetchQueue, reviewCard, type StudyCard } from "../lib/api";
import StudyCardView from "../components/StudyCard";
import { CardSkeletonLoader, ErrorMessage } from "../components/Loaders";

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

  if (loading) return (
    <div className="card-container">
      <div className="page-header mb-4">
        <Link to="/" className="nav-link">
          <span>←</span> Decks
        </Link>
      </div>
      <CardSkeletonLoader />
    </div>
  );

  if (error) {
    return (
      <div className="card-container">
        <div className="page-header mb-4">
          <Link to="/" className="nav-link">
            <span>←</span> Decks
          </Link>
        </div>
        <ErrorMessage message={error} />
        <button onClick={load} className="btn-secondary mt-8">Retry</button>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="empty-state">
        <h2>All caught up! 🎉</h2>
        <p>{reviewed > 0 ? `Reviewed ${reviewed} cards today. ` : ""}No cards due right now.</p>
        <div className="mt-8">
          <Link to="/" className="btn-primary">Back to decks</Link>
        </div>
      </div>
    );
  }

  const current = queue[0];

  return (
    <div className="card-container">
      <div className="page-header mb-4">
        <Link to="/" className="nav-link">
          <span>←</span> Decks
        </Link>
        <span className="badge">
          {queue.length} remaining
        </span>
      </div>
      <StudyCardView card={current} onRate={handleRate} />
    </div>
  );
}
