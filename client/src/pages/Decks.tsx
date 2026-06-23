import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { deleteDeck, fetchDecks, type Deck } from "../lib/api";
import { SkeletonLoader, ErrorMessage } from "../components/Loaders";

const pageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, y: -20, transition: { duration: 0.2 } }
};

export default function Decks() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Repeated Retry clicks (or a delete completing while a previous load is
  // still in flight) could otherwise let an older, slower response land
  // after a newer one and clobber it with stale data.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDecks()
      .then((data) => {
        if (cancelled) return;
        setDecks(data);
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
  }, [reloadToken]);

  const load = () => setReloadToken((n) => n + 1);

  const handleDelete = (id: number) => {
    // Stable id keyed on the deck: repeat clicks on the same Delete button
    // (e.g. double-click) update the existing confirm toast in place
    // instead of stacking duplicate confirmations.
    toast("Delete this deck and all its cards?", {
      id: `delete-deck-${id}`,
      action: {
        label: "Delete",
        onClick: async () => {
          try {
            await deleteDeck(id);
            toast.success("Deck deleted successfully");
            load();
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Failed to delete deck";
            toast.error(message);
          }
        }
      },
      cancel: {
        label: "Cancel",
        onClick: () => {}
      }
    });
  };

  if (loading) return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit">
      <div className="page-header">
        <h2>Decks</h2>
      </div>
      <SkeletonLoader />
      <div className="mt-4">
        <SkeletonLoader />
      </div>
    </motion.div>
  );

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit">
      <div className="page-header">
        <h2>Decks</h2>
        <div className="flex gap-2">
          <a href="/api/backup" className="btn-secondary" download>Download backup</a>
          <Link to="/import" className="btn-primary">+ Import</Link>
        </div>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorMessage message={error} />
          <button className="btn-secondary mt-4" onClick={load}>Retry</button>
        </div>
      )}
      
      {!error && decks.length === 0 && (
        <div className="empty-state">
          <p>No decks yet. Import an .apkg file or a textbook to get started.</p>
        </div>
      )}
      
      <ul className="deck-list">
        {decks.map((d) => (
          <li key={d.id} className="deck-item">
            <div className="deck-item-info">
              <strong>{d.name}</strong>
              <div className="deck-item-stats">
                {d.card_count} {d.card_count === 1 ? "card" : "cards"} · {d.due_count} due
              </div>
            </div>
            <div className="deck-item-actions">
              <Link to={`/study?deckId=${d.id}`} className="btn-primary">Study</Link>
              <button className="btn-danger" onClick={() => handleDelete(d.id)}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
      
      {decks.length > 0 && (
        <div className="mt-8 text-center">
          <Link to="/study" className="btn-primary lg">Study all due cards</Link>
        </div>
      )}
    </motion.div>
  );
}
