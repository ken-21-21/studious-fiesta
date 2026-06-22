import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { deleteDeck, fetchDecks, type Deck } from "../lib/api";
import { SkeletonLoader, ErrorMessage } from "../components/Loaders";

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

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this deck and all its cards?")) return;
    try {
      await deleteDeck(id);
      load();
    } catch (err: any) {
      setError(err.message ?? "Failed to delete deck");
    }
  };

  if (loading) return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h2>Decks</h2>
      </div>
      <SkeletonLoader />
      <div style={{ marginTop: '16px' }}>
        <SkeletonLoader />
      </div>
    </div>
  );

  return (
    <div>
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
    </div>
  );
}
