import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { importApkg, importTextbook, type ImportJob } from "../lib/api";

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
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // If the user navigates away during the 1.2s success delay, don't let a
  // stale timer fire navigate() after the component has already unmounted.
  useEffect(() => {
    return () => {
      if (navigateTimerRef.current) clearTimeout(navigateTimerRef.current);
    };
  }, []);

  const handleImport = async () => {
    if (!file || busy) return;
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
      toast.error("Unsupported file type. Use .apkg, or a document/media file (.txt, .pdf, .epub, image, audio, .srt/.vtt).");
      return;
    }

    setBusy(true);
    const toastId = toast.loading("Importing...");
    try {
      const name = deckName || file.name;
      if (isApkg) {
        const result = await importApkg(file, name);
        toast.success(`Imported ${result.cardsImported} cards.`, { id: toastId });
      } else {
        const result = await importTextbook(file, name, (job: ImportJob) => {
          if (job.message) toast.loading(job.message, { id: toastId });
        });
        const deckCount = result.decks.length;
        toast.success(
          `Created ${deckCount} deck${deckCount === 1 ? "" : "s"}, ${result.totalCards} card(s).`,
          { id: toastId }
        );
      }
      navigateTimerRef.current = setTimeout(() => navigate("/"), 1200);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Import failed";
      toast.error(`Error: ${message}`, { id: toastId });
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div className="glass-panel" variants={pageVariants} initial="initial" animate="animate" exit="exit">
      <h2>Import</h2>
      <p>Drop an Anki <code>.apkg</code> export, or a document/media file — text, PDF, EPUB, image (OCR), audio (ASR), or subtitles.</p>

      <div className="form-group mt-8">
        <input
          type="file"
          aria-label="Import file"
          accept=".apkg,.txt,.pdf,.epub,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.mp4,.srt,.vtt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <input
          type="text"
          placeholder="Deck name (optional)"
          aria-label="Deck name"
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
