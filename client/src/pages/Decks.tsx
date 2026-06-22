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

  if (loading) return <p>Loading decks...</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Decks</h2>
        <Link to="/import">+ Import</Link>
      </div>
      {error && (
        <p style={{ color: "#dc2626" }}>
          {error} <button onClick={load}>Retry</button>
        </p>
      )}
      {!error && decks.length === 0 && (
        <p>No decks yet. Import an .apkg file or a textbook to get started.</p>
      )}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {decks.map((d) => (
          <li
            key={d.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              background: "#fff",
              borderRadius: 8,
              marginBottom: 8,
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            }}
          >
            <div>
              <strong>{d.name}</strong>
              <div style={{ fontSize: 13, color: "#64748b" }}>
                {d.card_count} cards · {d.due_count} due
              </div>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <Link to={`/study?deckId=${d.id}`}>Study</Link>
              <button onClick={() => handleDelete(d.id)}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
      {decks.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <Link to="/study">Study all due cards</Link>
        </div>
      )}
    </div>
  );
}
