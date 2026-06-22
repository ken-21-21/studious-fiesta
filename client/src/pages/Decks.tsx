import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { deleteDeck, fetchDecks, type Deck } from "../lib/api";

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

  if (loading) return <div className="empty-state"><p>Loading decks...</p></div>;

  return (
    <div>
      <div className="page-header">
        <h2>Decks</h2>
        <Link to="/import" className="btn-primary">+ Import</Link>
      </div>
      
      {error && (
        <div className="empty-state">
          <p className="error-text">{error}</p>
          <button onClick={load}>Retry</button>
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
