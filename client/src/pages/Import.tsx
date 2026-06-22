import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { importApkg, importTextbook } from "../lib/api";

export default function Import() {
  const [file, setFile] = useState<File | null>(null);
  const [deckName, setDeckName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const handleImport = async () => {
    if (!file) return;
    setBusy(true);
    setStatus("Importing...");
    try {
      const isApkg = file.name.toLowerCase().endsWith(".apkg");
      const name = deckName || file.name;
      const result = isApkg
        ? await importApkg(file, name)
        : await importTextbook(file, name);
      setStatus(
        isApkg
          ? `Imported ${result.cardsImported} cards.`
          : `Created ${result.cardsCreated} cards from ${result.sentencesProcessed} sentences.`
      );
      setTimeout(() => navigate("/"), 1200);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>Import</h2>
      <p>Drop an Anki <code>.apkg</code> export, or a textbook/text file (<code>.txt</code>, <code>.pdf</code>).</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}>
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
        <button disabled={!file || busy} onClick={handleImport}>
          {busy ? "Importing..." : "Import"}
        </button>
        {status && <p>{status}</p>}
      </div>
    </div>
  );
}
