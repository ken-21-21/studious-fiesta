import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { fetchQueue, reviewCard, type StudyCard } from "../lib/api";
import StudyCardView from "../components/StudyCard";
import { CardSkeletonLoader, ErrorMessage } from "../components/Loaders";

const pageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, y: -20, transition: { duration: 0.2 } }
};

export default function Study() {
  const [params] = useSearchParams();
  const deckId = params.get("deckId") ? Number(params.get("deckId")) : undefined;
  const [queue, setQueue] = useState<StudyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewed, setReviewed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReviewed(0);
    fetchQueue(deckId, 30)
      .then((data) => {
        if (cancelled) return;
        setQueue(data);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deckId, reloadToken]);

  const handleRate = async (rating: 1 | 2 | 3 | 4) => {
    const [current, ...rest] = queue;
    if (!current || submitting) return;
    setSubmitting(true);
    try {
      await reviewCard(current.id, rating);
      setQueue(rest);
      setReviewed((n) => n + 1);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to submit review");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <motion.div className="card-container" variants={pageVariants} initial="initial" animate="animate" exit="exit">
      <div className="page-header mb-4">
        <Link to="/" className="nav-link">
          <span>←</span> Decks
        </Link>
      </div>
      <CardSkeletonLoader />
    </motion.div>
  );

  if (error) {
    return (
      <motion.div className="card-container" variants={pageVariants} initial="initial" animate="animate" exit="exit">
        <div className="page-header mb-4">
          <Link to="/" className="nav-link">
            <span>←</span> Decks
          </Link>
        </div>
        <ErrorMessage message={error} />
        <button onClick={() => setReloadToken((n) => n + 1)} className="btn-secondary mt-8">Retry</button>
      </motion.div>
    );
  }

  if (queue.length === 0) {
    return (
      <motion.div className="empty-state" variants={pageVariants} initial="initial" animate="animate" exit="exit">
        <h2>All caught up! 🎉</h2>
        <p>{reviewed > 0 ? `Reviewed ${reviewed} cards today. ` : ""}No cards due right now.</p>
        <div className="mt-8">
          <Link to="/" className="btn-primary">Back to decks</Link>
        </div>
      </motion.div>
    );
  }

  const current = queue[0];

  return (
    <motion.div className="card-container" variants={pageVariants} initial="initial" animate="animate" exit="exit">
      <div className="page-header mb-4">
        <Link to="/" className="nav-link">
          <span>←</span> Decks
        </Link>
        <span className="badge">
          {queue.length} remaining
        </span>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          <StudyCardView card={current} onRate={handleRate} ratingDisabled={submitting} />
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
