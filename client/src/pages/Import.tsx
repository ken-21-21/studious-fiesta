import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { importApkg, importTextbook, type ImportJob } from "../lib/api";
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
    const MEDIA_EXTS = [
      ".txt", ".pdf", ".epub",
      ".png", ".jpg", ".jpeg", ".webp",
      ".mp3", ".wav", ".m4a", ".mp4",
      ".srt", ".vtt",
    ];
    const isSupported = isApkg || MEDIA_EXTS.some((ext) => lowerName.endsWith(ext));
    if (!isSupported) {
      setStatus("Error: unsupported file type. Use .apkg, or a document/media file (.txt, .pdf, .epub, image, audio, .srt/.vtt).");
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
      <p>Drop an Anki <code>.apkg</code> export, or a document/media file — text, PDF, EPUB, image (OCR), audio (ASR), or subtitles.</p>

      <div className="form-group mt-8">
        <input
          type="file"
          accept=".apkg,.txt,.pdf,.epub,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.mp4,.srt,.vtt"
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
