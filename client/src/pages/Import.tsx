import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { importApkg, importTextbook, type ImportJob } from "../lib/api";

export default function Import() {
  const [file, setFile] = useState<File | null>(null);
  const [deckName, setDeckName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const handleImport = async () => {
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    const isApkg = lowerName.endsWith(".apkg");
    const isSupported = isApkg || lowerName.endsWith(".txt") || lowerName.endsWith(".pdf");
    if (!isSupported) {
      setStatus("Error: unsupported file type. Use .apkg, .txt, or .pdf.");
      return;
    }

    setBusy(true);
    setStatus("Importing...");
    try {
      const name = deckName || file.name;
      if (isApkg) {
        const result = await importApkg(file, name);
        setStatus(`Imported ${result.cardsImported} cards.`);
      } else {
        const result = await importTextbook(file, name, (job: ImportJob) => {
          if (job.message) setStatus(job.message);
        });
        const deckCount = result.decks.length;
        setStatus(
          `Created ${deckCount} deck${deckCount === 1 ? "" : "s"}, ${result.totalCards} card(s).`
        );
      }
      setTimeout(() => navigate("/"), 1200);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="glass-panel">
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
        {status && <p className={status.startsWith("Error") ? "error-text mt-8" : "mt-8"}>{status}</p>}
      </div>
    </div>
  );
}
