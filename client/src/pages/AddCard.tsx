import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { addNote, fetchDecks, type Deck } from "../lib/api";

const pageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, y: -20, transition: { duration: 0.2 } }
};

export default function AddCard() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckId, setDeckId] = useState<string>("");
  const [deckName, setDeckName] = useState("");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchDecks().then(setDecks).catch(() => {});
  }, []);

  const handleAdd = async (keepGoing: boolean) => {
    if (!front.trim() || !back.trim()) {
      toast.error("Front and back are both required.");
      return;
    }
    setBusy(true);
    try {
      const result = await addNote({
        deckId: deckId ? Number(deckId) : undefined,
        deckName: deckId ? undefined : deckName,
        front,
        back,
      });
      if (!deckId) {
        setDeckId(String(result.deckId));
        fetchDecks().then(setDecks).catch(() => {});
      }
      setFront("");
      setBack("");
      toast.success("Card added.");
      if (!keepGoing) navigate(`/study?deckId=${result.deckId}`);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to add card");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="glass-panel" variants={pageVariants} initial="initial" animate="animate" exit="exit">
      <h2>Add a card</h2>
      <p>Quickly add a single front/back card without a full import.</p>

      <div className="form-group mt-8">
        <select value={deckId} onChange={(e) => setDeckId(e.target.value)}>
          <option value="">New deck…</option>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        {!deckId && (
          <input
            type="text"
            placeholder="New deck name (optional, defaults to Manual)"
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
          />
        )}
        <input
          type="text"
          placeholder="Front"
          value={front}
          onChange={(e) => setFront(e.target.value)}
        />
        <input
          type="text"
          placeholder="Back"
          value={back}
          onChange={(e) => setBack(e.target.value)}
        />
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => handleAdd(true)} className="btn-secondary">
            {busy ? "Adding…" : "Add & add another"}
          </button>
          <button disabled={busy} onClick={() => handleAdd(false)} className="btn-primary">
            {busy ? "Adding…" : "Add & study"}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
