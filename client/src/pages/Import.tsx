import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { importApkg, importTextbook } from "../lib/api";

const pageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  exit: { opacity: 0, y: -20, transition: { duration: 0.2 } }
};

export default function Import() {
  const [file, setFile] = useState<File | null>(null);
  const [deckName, setDeckName] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const handleImport = async () => {
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    const isApkg = lowerName.endsWith(".apkg");
    const isSupported = isApkg || lowerName.endsWith(".txt") || lowerName.endsWith(".pdf");
    if (!isSupported) {
      toast.error("Unsupported file type. Use .apkg, .txt, or .pdf.");
      return;
    }

    setBusy(true);
    const toastId = toast.loading("Importing...");
    try {
      const name = deckName || file.name;
      const result = isApkg
        ? await importApkg(file, name)
        : await importTextbook(file, name);
      
      toast.success(
        isApkg
          ? `Imported ${result.cardsImported} cards.`
          : `Created ${result.cardsCreated} cards from ${result.sentencesProcessed} sentences.`,
        { id: toastId }
      );
      setTimeout(() => navigate("/"), 1200);
    } catch (err: any) {
      toast.error(`Error: ${err.message}`, { id: toastId });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="glass-panel" variants={pageVariants} initial="initial" animate="animate" exit="exit">
      <h2>Import</h2>
      <p>Drop an Anki <code>.apkg</code> export, or a textbook/text file (<code>.txt</code>, <code>.pdf</code>).</p>
      
      <div className="form-group mt-8">
        <input
          type="file"
          accept=".apkg,.txt,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <input
          type="text"
          placeholder="Deck name (optional)"
          value={deckName}
          onChange={(e) => setDeckName(e.target.value)}
        />
        <button disabled={!file || busy} onClick={handleImport} className="btn-primary lg">
          {busy ? "Importing..." : "Import"}
        </button>
      </div>
    </motion.div>
  );
}
