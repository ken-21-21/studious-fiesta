import React, { useEffect, useMemo, useState } from "react";
import { fetchNoteAnalysis, submitCorrection, type NoteAnalysis, type StudyCard, type CorrectionPayload } from "../lib/api";
import "./CardTypes.css";

interface Props {
  card: StudyCard;
  onRate: (rating: 1 | 2 | 3 | 4) => void;
}

function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(utter);
}

function CorrectionForm({
  analysis,
  provenance,
  onCancel,
  onSuccess
}: {
  analysis: NoteAnalysis;
  provenance?: StudyCard["provenance"];
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<CorrectionPayload["scope"]>("occurrence");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitCorrection({
        kind: analysis.kind,
        surface: analysis.surface,
        scope,
        value,
        sourceId: provenance?.sourceId,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="correction-form" onSubmit={handleSubmit}>
      <div className="correction-header">Correct {analysis.kind} for "{analysis.surface}"</div>
      {error && <p className="error-text">{error}</p>}
      <label>
        Correct value:
        <input value={value} onChange={e => setValue(e.target.value)} disabled={submitting} required />
      </label>
      <label>
        Scope:
        <select value={scope} onChange={e => setScope(e.target.value as any)} disabled={submitting}>
          <option value="occurrence">Occurrence</option>
          <option value="sentence">Sentence</option>
          <option value="source">Source</option>
          <option value="deck">Deck</option>
          <option value="matching">Matching</option>
          <option value="global">Global</option>
        </select>
      </label>
      <div className="correction-actions">
        <button type="submit" disabled={submitting || !value.trim()}>Submit</button>
        <button type="button" onClick={onCancel} disabled={submitting}>Cancel</button>
      </div>
    </form>
  );
}

function AnalysisPanel({ noteId, provenance }: { noteId: number; provenance?: StudyCard["provenance"] }) {
  const [open, setOpen] = useState(false);
  const [analysis, setAnalysis] = useState<NoteAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correctingIdx, setCorrectingIdx] = useState<number | null>(null);

  const toggle = () => {
    if (!open && analysis.length === 0) {
      setLoading(true);
      setError(null);
      fetchNoteAnalysis(noteId)
        .then(setAnalysis)
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
    setOpen(!open);
  };

  return (
    <div className="analysis-panel">
      <button className="analysis-toggle" onClick={toggle}>
        {open ? "Hide Details" : "Show Analysis & Provenance"}
      </button>
      {open && (
        <div className="analysis-content">
          {provenance && (
            <div className="provenance-info">
              <strong>Source:</strong> {provenance.filename} ({provenance.kind})
            </div>
          )}
          {loading ? (
            <p>Loading analysis...</p>
          ) : error ? (
            <p className="error-text">Failed to load analysis: {error}</p>
          ) : analysis.length === 0 ? (
            <p>No analysis found.</p>
          ) : (
            <ul className="analysis-list">
              {analysis.map((a, i) => (
                <li key={i} className={`analysis-item band-${a.band}`}>
                  <div className="analysis-main">
                    <span className="analysis-surface">{a.surface}</span>
                    <span className="analysis-label">{a.label}</span>
                    <span className="analysis-conf">{(a.confidence * 100).toFixed(0)}% conf</span>
                    {a.evidence && (
                      <span className="analysis-evidence" title={JSON.stringify(a.evidence)}>
                        (Evidence: {typeof a.evidence === 'string' ? a.evidence : 'Yes'})
                      </span>
                    )}
                    <button className="btn-correct" onClick={() => setCorrectingIdx(i)}>
                      Correct
                    </button>
                  </div>
                  {correctingIdx === i && (
                    <CorrectionForm
                      analysis={a}
                      provenance={provenance}
                      onCancel={() => setCorrectingIdx(null)}
                      onSuccess={() => {
                        setCorrectingIdx(null);
                        setLoading(true);
                        fetchNoteAnalysis(noteId)
                          .then(setAnalysis)
                          .catch(err => setError(err.message))
                          .finally(() => setLoading(false));
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function RatingRow({ onRate }: { onRate: Props["onRate"] }) {
  return (
    <div className="rating-row">
      <button className="rating-btn rating-again" onClick={() => onRate(1)}>Again</button>
      <button className="rating-btn rating-hard" onClick={() => onRate(2)}>Hard</button>
      <button className="rating-btn rating-good" onClick={() => onRate(3)}>Good</button>
      <button className="rating-btn rating-easy" onClick={() => onRate(4)}>Easy</button>
    </div>
  );
}

function Media({ media }: { media: StudyCard["media"] }) {
  const [failed, setFailed] = useState(false);
  if (!media?.image || failed) return null;
  return (
    <div className="card-media">
      <img src={`/media/${media.image}`} alt="" onError={() => setFailed(true)} />
    </div>
  );
}

function BasicCard({ card, onRate }: { card: Extract<StudyCard, { card_type: "basic" }>; onRate: Props["onRate"] }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="card-surface">
      <Media media={card.media} />
      <div className="card-prompt">{card.question.text}</div>
      {revealed && <div className="card-answer">{card.answer.text}</div>}
      {!revealed ? (
        <button className="text-input" onClick={() => setRevealed(true)}>
          Show answer
        </button>
      ) : (
        <>
          <RatingRow onRate={onRate} />
          <AnalysisPanel noteId={card.note_id} provenance={card.provenance} />
        </>
      )}
    </div>
  );
}

function ClozeCard({ card, onRate }: { card: Extract<StudyCard, { card_type: "cloze" }>; onRate: Props["onRate"] }) {
  const [revealed, setRevealed] = useState(false);
  const display = revealed
    ? card.question.text.replace("_____", `[${card.answer.text}]`)
    : card.question.text;
  return (
    <div className="card-surface">
      <Media media={card.media} />
      <div className="card-prompt">{display}</div>
      {!revealed ? (
        <button className="text-input" onClick={() => setRevealed(true)}>
          Show answer
        </button>
      ) : (
        <>
          <RatingRow onRate={onRate} />
          <AnalysisPanel noteId={card.note_id} provenance={card.provenance} />
        </>
      )}
    </div>
  );
}

function ListeningCard({ card, onRate }: { card: Extract<StudyCard, { card_type: "listening" }>; onRate: Props["onRate"] }) {
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState("");
  const audioUrl = card.media?.audio ? `/media/${card.media.audio}` : null;

  const playAudio = () => {
    if (audioUrl) {
      // Autoplay (without a user gesture) is blocked by most browsers and
      // rejects the play() promise; that's expected on mount, so swallow it.
      new Audio(audioUrl).play().catch(() => {});
    } else if (card.question.tts) {
      speak(card.question.tts);
    }
  };

  useEffect(() => {
    playAudio();
  }, [card.id]);

  return (
    <div className="card-surface">
      <button className="listen-btn" onClick={playAudio} aria-label="Play audio">
        🔊
      </button>
      {!revealed && (
        <input
          className="text-input"
          placeholder="Type what you heard..."
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      )}
      {revealed && <div className="card-answer">{card.answer.text}</div>}
      {!revealed ? (
        <button className="text-input" onClick={() => setRevealed(true)}>
          Show answer
        </button>
      ) : (
        <>
          <RatingRow onRate={onRate} />
          <AnalysisPanel noteId={card.note_id} provenance={card.provenance} />
        </>
      )}
    </div>
  );
}

function ScrambleCard({ card, onRate }: { card: Extract<StudyCard, { card_type: "scramble" }>; onRate: Props["onRate"] }) {
  const [placedIdx, setPlacedIdx] = useState<number[]>([]);
  const [revealed, setRevealed] = useState(false);
  const words: string[] = card.question.words;
  const correct: string[] = card.answer.words;

  const built = placedIdx.map((i) => words[i]).join(" ");
  const isCorrect = useMemo(() => built === correct.join(" "), [built, correct]);

  const pick = (idx: number) => {
    if (placedIdx.includes(idx) || revealed) return;
    setPlacedIdx([...placedIdx, idx]);
  };
  const undo = () => setPlacedIdx(placedIdx.slice(0, -1));

  return (
    <div className="card-surface">
      <div className="card-prompt">Put the sentence in order</div>
      <div className="scramble-answer-row">
        {placedIdx.map((i) => (
          <span key={i} className="scramble-chip" onClick={undo}>
            {words[i]}
          </span>
        ))}
      </div>
      <div className="scramble-row">
        {words.map((w, i) => (
          <span
            key={i}
            className={`scramble-chip ${placedIdx.includes(i) ? "placed" : ""}`}
            onClick={() => pick(i)}
          >
            {w}
          </span>
        ))}
      </div>
      {revealed && (
        <div className="card-answer">
          {isCorrect ? "Correct! " : "Correct order: "}
          {correct.join(" ")}
        </div>
      )}
      {!revealed ? (
        <button className="text-input" onClick={() => setRevealed(true)}>
          Check
        </button>
      ) : (
        <>
          <RatingRow onRate={onRate} />
          <AnalysisPanel noteId={card.note_id} provenance={card.provenance} />
        </>
      )}
    </div>
  );
}

export default function StudyCardView({ card, onRate }: Props) {
  switch (card.card_type) {
    case "cloze":
      return <ClozeCard card={card as Extract<StudyCard, { card_type: "cloze" }>} onRate={onRate} />;
    case "listening":
      return <ListeningCard card={card as Extract<StudyCard, { card_type: "listening" }>} onRate={onRate} />;
    case "scramble":
      return <ScrambleCard card={card as Extract<StudyCard, { card_type: "scramble" }>} onRate={onRate} />;
    case "basic":
    default:
      return <BasicCard card={card as Extract<StudyCard, { card_type: "basic" }>} onRate={onRate} />;
  }
}
