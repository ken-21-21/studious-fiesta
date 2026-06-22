import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { importApkg, importTextbook } from "../lib/api";
import { ErrorMessage } from "../components/Loaders";

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
        {status && (
          <div className="mt-8">
            {status.startsWith("Error") ? (
              <ErrorMessage message={status.replace("Error: ", "")} />
            ) : (
              <p style={{ color: "var(--success)", fontWeight: 500 }}>{status}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
