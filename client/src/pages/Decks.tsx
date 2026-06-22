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

  const load = () => {
    setLoading(true);
    setError(null);
    fetchDecks()
      .then(setDecks)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleDelete = (id: number) => {
    toast("Delete this deck and all its cards?", {
      action: {
        label: "Delete",
        onClick: async () => {
          try {
            await deleteDeck(id);
            toast.success("Deck deleted successfully");
            load();
          } catch (err: any) {
            toast.error(err.message ?? "Failed to delete deck");
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
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h2>Decks</h2>
      </div>
      <SkeletonLoader />
      <div style={{ marginTop: '16px' }}>
        <SkeletonLoader />
      </div>
    </motion.div>
  );

  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2>Decks</h2>
        <Link to="/import" className="btn-primary">+ Import</Link>
      </div>
      
      {error && (
        <div style={{ marginBottom: '24px' }}>
          <ErrorMessage message={error} />
          <button className="btn-secondary" onClick={load} style={{ marginTop: '16px' }}>Retry</button>
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
                {d.card_count} cards · {d.due_count} due
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
