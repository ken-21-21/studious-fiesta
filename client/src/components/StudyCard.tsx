import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchNoteAnalysis,
  submitCorrection,
  type CorrectionScope,
  type FuriganaSegment,
  type NoteAnalysis,
  type PitchInfo,
  type StudyCard,
} from "../lib/api";
import { motion } from "framer-motion";
import "./CardTypes.css";

interface Props {
  card: StudyCard;
  onRate: (rating: 1 | 2 | 3 | 4) => void;
  ratingDisabled?: boolean;
}

// Renders kanji with readings as <ruby>/<rt>, flagging segments whose reading
// the analyzer couldn't confirm rather than presenting them as settled fact.
function Furigana({ segments }: { segments?: FuriganaSegment[] }) {
  if (!segments || segments.length === 0) return null;
  return (
    <span className="furigana-line">
      {segments.map((seg, i) =>
        seg.reading ? (
          <ruby key={i} className={seg.uncertain ? "furigana-uncertain" : undefined}>
            {seg.text}
            <rt>{seg.reading}{seg.uncertain ? "?" : ""}</rt>
          </ruby>
        ) : seg.uncertain ? (
          // Reading withheld entirely (not even a best guess) — still must
          // not look identical to plain kana/punctuation text; mark it so
          // the user knows this word's reading needs review.
          <ruby key={i} className="furigana-uncertain">
            {seg.text}
            <rt>?</rt>
          </ruby>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </span>
  );
}

function summarizeEvidence(evidence: unknown): string | null {
  if (!evidence) return null;
  if (typeof evidence === "string") return evidence;
  if (!Array.isArray(evidence)) return "Evidence available";
  const parts = evidence
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const source = typeof (entry as { source?: unknown }).source === "string"
        ? (entry as { source: string }).source
        : null;
      const detail = typeof (entry as { detail?: unknown }).detail === "string"
        ? (entry as { detail: string }).detail
        : null;
      if (source && detail) return `${source}: ${detail}`;
      return source ?? detail;
    })
    .filter((v): v is string => Boolean(v));
  return parts.length ? parts.join(" · ") : "Evidence available";
}

// Pitch accent as a high/low step diagram over the word's morae.
function PitchDiagram({ pitch, morae }: { pitch: PitchInfo; morae?: string[] }) {
  const units = morae && morae.length ? morae : pitch.morae;
  return (
    <div className="pitch-diagram">
      <div className="pitch-track">
        {units.map((mora, i) => {
          const level = pitch.pattern[i] ?? "L";
          return (
            <div key={i} className={`pitch-mora pitch-${level === "H" ? "high" : "low"}`}>
              <span className="pitch-mora-text">{mora}</span>
            </div>
          );
        })}
        <div className={`pitch-mora pitch-${pitch.particle === "H" ? "high" : "low"} pitch-particle`}>
          <span className="pitch-mora-text">…</span>
        </div>
      </div>
      <div className="pitch-label">{pitch.type} (accent on mora {pitch.accent || "—"})</div>
    </div>
  );
}

function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(utter);
}

// Lets a user override an analyzer claim (reading/grammar) for a specific
// surface form. Submits to the corrections endpoint, scoped per the user's
// choice; the analyzer/cardgen pipeline picks it up on the next pass.
function CorrectionForm({
  kind,
  surface,
  sourceId,
  deckId,
  onDone,
}: {
  kind: "reading" | "grammar";
  surface: string;
  sourceId?: number;
  deckId?: number;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<CorrectionScope>("global");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!value.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitCorrection({ kind, surface, value: value.trim(), scope, sourceId, deckId });
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to submit correction");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="correction-form">
      <input
        className="correction-input"
        placeholder={`Correct reading for "${surface}"`}
        aria-label={`Correct ${kind} for "${surface}"`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <select
        className="correction-scope"
        aria-label="Correction scope"
        value={scope}
        onChange={(e) => setScope(e.target.value as CorrectionScope)}
      >
        <option value="occurrence">Just this occurrence</option>
        <option value="sentence">This sentence</option>
        <option value="source">This source</option>
        <option value="deck">This deck</option>
        <option value="matching">Anywhere this surface appears</option>
        <option value="global">Always (global)</option>
      </select>
      <button className="correction-submit" onClick={submit} disabled={submitting || !value.trim()}>
        {submitting ? "Saving…" : "Submit"}
      </button>
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}

function AnalysisPanel({
  noteId,
  deckId,
  provenance,
}: {
  noteId: number;
  deckId: number;
  provenance?: StudyCard["provenance"];
}) {
  const [open, setOpen] = useState(false);
  const [analysis, setAnalysis] = useState<NoteAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correctingIdx, setCorrectingIdx] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchNoteAnalysis(noteId)
      .then(setAnalysis)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  const toggle = () => {
    if (!open && analysis.length === 0) load();
    // Closing the panel should also drop any in-progress correction form —
    // otherwise reopening shows a stale "Cancel" state for an item the user
    // never actually meant to keep editing.
    if (open) setCorrectingIdx(null);
    setOpen(!open);
  };

  return (
    <div className="analysis-panel">
      <button className="analysis-toggle" onClick={toggle} aria-expanded={open}>
        {open ? "Hide Details" : "Show Analysis & Provenance"}
      </button>
      {open && (
        <div className="analysis-content">
          <p className="analysis-help">
            Low confidence or “needs review” means the app is surfacing uncertainty, not asserting a fact.
          </p>
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
                  <div className="analysis-item-row">
                    <span className="analysis-surface">{a.surface}</span>
                    <span className="analysis-label">{a.label}</span>
                    <span className="analysis-conf">{(a.confidence * 100).toFixed(0)}% conf</span>
                    {a.needsReview && <span className="analysis-review-flag">Needs review</span>}
                    {summarizeEvidence(a.evidence) && (
                      <span className="analysis-evidence" title={summarizeEvidence(a.evidence) ?? undefined}>
                        {summarizeEvidence(a.evidence)}
                      </span>
                    )}
                    {(a.kind === "reading" || a.kind === "grammar") && (
                      <button
                        className="analysis-correct-btn"
                        aria-expanded={correctingIdx === i}
                        onClick={() => setCorrectingIdx(correctingIdx === i ? null : i)}
                      >
                        {correctingIdx === i ? "Cancel" : "Correct"}
                      </button>
                    )}
                  </div>
                  {correctingIdx === i && (a.kind === "reading" || a.kind === "grammar") && (
                    <CorrectionForm
                      kind={a.kind}
                      surface={a.surface}
                      sourceId={provenance?.sourceId}
                      deckId={deckId}
                      onDone={() => {
                        setCorrectingIdx(null);
                        load();
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

// `focusOnReveal` moves keyboard focus to the first rating button once the
// card flips to its answer side. Flip-cards keep both faces mounted at all
// times (only `rotateY` changes), so a plain `autoFocus` prop won't refire
// on reveal — without this, focus stays on the now-hidden "Show answer"
// button and keyboard users lose track of where they are.
function RatingRow({ onRate, disabled, focusOnReveal }: { onRate: Props["onRate"]; disabled?: boolean; focusOnReveal?: boolean }) {
  const firstBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusOnReveal) firstBtnRef.current?.focus();
  }, [focusOnReveal]);

  return (
    <div className="rating-row">
      <button ref={firstBtnRef} className="rating-btn rating-again" onClick={() => onRate(1)} disabled={disabled}>Again</button>
      <button className="rating-btn rating-hard" onClick={() => onRate(2)} disabled={disabled}>Hard</button>
      <button className="rating-btn rating-good" onClick={() => onRate(3)} disabled={disabled}>Good</button>
      <button className="rating-btn rating-easy" onClick={() => onRate(4)} disabled={disabled}>Easy</button>
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

function BasicCard({ card, onRate, ratingDisabled }: { card: Extract<StudyCard, { card_type: "basic" }>; onRate: Props["onRate"]; ratingDisabled?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <motion.div 
      className="flip-card-inner"
      initial={false}
      animate={{ rotateY: revealed ? 180 : 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
    >
      <div className="flip-card-front card-surface">
        <Media media={card.media} />
        <div className="card-prompt">{card.question.text}</div>
        <button className="text-input" onClick={() => setRevealed(true)}>
          Show answer
        </button>
      </div>
      <div className="flip-card-back card-surface">
        <Media media={card.media} />
        <div className="card-prompt">{card.question.text}</div>
        <div className="card-answer">{card.answer.text}</div>
        <RatingRow onRate={onRate} disabled={ratingDisabled} focusOnReveal={revealed} />
        <AnalysisPanel noteId={card.note_id} deckId={card.deck_id} provenance={card.provenance} />
      </div>
    </motion.div>
  );
}

function ClozeCard({ card, onRate, ratingDisabled }: { card: Extract<StudyCard, { card_type: "cloze" }>; onRate: Props["onRate"]; ratingDisabled?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <motion.div 
      className="flip-card-inner"
      initial={false}
      animate={{ rotateY: revealed ? 180 : 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
    >
      <div className="flip-card-front card-surface">
        <Media media={card.media} />
        <div className="card-prompt">
          {card.question.furigana ? <Furigana segments={card.question.furigana} /> : card.question.text}
        </div>
        <button className="text-input" onClick={() => setRevealed(true)}>
          Show answer
        </button>
      </div>
      <div className="flip-card-back card-surface">
        <Media media={card.media} />
        <div className="card-prompt">
          {card.question.furigana ? <Furigana segments={card.question.furigana} /> : card.question.text}
        </div>
        <div className="card-answer">
          {card.answer.furigana
            ? <Furigana segments={card.answer.furigana} />
            : card.answer.readingUncertain
              ? <ruby className="furigana-uncertain">{card.answer.text}<rt>?</rt></ruby>
              : card.answer.text}
        </div>
        <RatingRow onRate={onRate} disabled={ratingDisabled} focusOnReveal={revealed} />
        <AnalysisPanel noteId={card.note_id} deckId={card.deck_id} provenance={card.provenance} />
      </div>
    </motion.div>
  );
}

function ListeningCard({ card, onRate, ratingDisabled }: { card: Extract<StudyCard, { card_type: "listening" }>; onRate: Props["onRate"]; ratingDisabled?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState("");
  const audioUrl = card.media?.audio ? `/media/${card.media.audio}` : null;
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playAudio = useCallback(() => {
    if (audioUrl) {
      // Stop any still-playing clip first — without this, clicking the
      // speaker button twice in quick succession overlaps two playbacks.
      audioRef.current?.pause();
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.play().catch(() => {});
    } else if (card.question.tts) {
      speak(card.question.tts);
    }
  }, [audioUrl, card.question.tts]);

  useEffect(() => {
    playAudio();
    return () => {
      audioRef.current?.pause();
    };
  }, [card.id, playAudio]);

  return (
    <motion.div
      className="flip-card-inner"
      initial={false}
      animate={{ rotateY: revealed ? 180 : 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
    >
      <div className="flip-card-front card-surface">
        <button className="listen-btn" onClick={playAudio} aria-label="Play audio">
          🔊
        </button>
        <input
          className="text-input"
          placeholder="Type what you heard..."
          aria-label="Type what you heard"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button className="text-input" onClick={() => setRevealed(true)}>
          Show answer
        </button>
      </div>
      <div className="flip-card-back card-surface">
        <button className="listen-btn" onClick={playAudio} aria-label="Play audio">
          🔊
        </button>
        {typed && <div className="card-prompt typed-recap">You typed: {typed}</div>}
        <div className="card-answer">
          {card.answer.furigana ? <Furigana segments={card.answer.furigana} /> : card.answer.text}
        </div>
        <RatingRow onRate={onRate} disabled={ratingDisabled} focusOnReveal={revealed} />
        <AnalysisPanel noteId={card.note_id} deckId={card.deck_id} provenance={card.provenance} />
      </div>
    </motion.div>
  );
}

function ScrambleCard({ card, onRate, ratingDisabled }: { card: Extract<StudyCard, { card_type: "scramble" }>; onRate: Props["onRate"]; ratingDisabled?: boolean }) {
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
  // Remove a specific placed word (by its position in placedIdx), not just
  // the most recently placed one — each chip in the answer row claims to
  // remove itself via its aria-label, so the click handler must match.
  const removeAt = (position: number) =>
    setPlacedIdx(placedIdx.filter((_, i) => i !== position));

  return (
    <motion.div 
      className="flip-card-inner"
      initial={false}
      animate={{ rotateY: revealed ? 180 : 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
    >
      <div className="flip-card-front card-surface">
        <div className="card-prompt">Put the sentence in order</div>
        <div className="scramble-answer-row">
          {placedIdx.map((i, position) => (
            <span
              key={position}
              className="scramble-chip"
              role="button"
              tabIndex={0}
              aria-label={`Remove "${words[i]}" from sentence`}
              onClick={() => removeAt(position)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  removeAt(position);
                }
              }}
            >
              {words[i]}
            </span>
          ))}
        </div>
        <div className="scramble-row">
          {words.map((w, i) => {
            const placed = placedIdx.includes(i);
            return (
              <span
                key={i}
                className={`scramble-chip ${placed ? "placed" : ""}`}
                role="button"
                tabIndex={placed ? -1 : 0}
                aria-disabled={placed}
                aria-label={placed ? `${w} (already placed)` : `Add "${w}" to sentence`}
                onClick={() => pick(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pick(i);
                  }
                }}
              >
                {w}
              </span>
            );
          })}
        </div>
        <button className="text-input" onClick={() => setRevealed(true)}>
          Check
        </button>
      </div>
      <div className="flip-card-back card-surface">
        <div className="card-prompt">Put the sentence in order</div>
        <div className="card-answer">
          {isCorrect ? "Correct! " : "Correct order: "}
          {card.answer.wordFurigana
            ? <span className="furigana-line">
                {card.answer.words.map((w, i) => {
                  const segs = card.answer.wordFurigana![i];
                  return (
                    <span key={i}>
                      {segs && segs.some((s) => s.reading || s.uncertain)
                        ? segs.map((seg, j) =>
                            seg.reading ? (
                              <ruby key={j} className={seg.uncertain ? "furigana-uncertain" : undefined}>
                                {seg.text}<rt>{seg.reading}{seg.uncertain ? "?" : ""}</rt>
                              </ruby>
                            ) : seg.uncertain ? (
                              <ruby key={j} className="furigana-uncertain">
                                {seg.text}<rt>?</rt>
                              </ruby>
                            ) : (
                              <span key={j}>{seg.text}</span>
                            )
                          )
                        : w}
                      {" "}
                    </span>
                  );
                })}
              </span>
            : correct.join(" ")}
        </div>
        <RatingRow onRate={onRate} disabled={ratingDisabled} focusOnReveal={revealed} />
        <AnalysisPanel noteId={card.note_id} deckId={card.deck_id} provenance={card.provenance} />
      </div>
    </motion.div>
  );
}

function VocabCard({ card, onRate, ratingDisabled }: { card: Extract<StudyCard, { card_type: "vocab" }>; onRate: Props["onRate"]; ratingDisabled?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="card-surface">
      <Media media={card.media} />
      {card.question.prompt && <div className="card-prompt-label">{card.question.prompt}</div>}
      <div className="card-prompt">
        {card.question.furigana ? <Furigana segments={card.question.furigana} /> : card.question.text}
      </div>
      {revealed && (
        <div className="card-answer">
          {card.answer.furigana ? <Furigana segments={card.answer.furigana} /> : card.answer.text}
        </div>
      )}
      {!revealed ? (
        <button className="text-input" onClick={() => setRevealed(true)}>
          Show answer
        </button>
      ) : (
        <>
          <RatingRow onRate={onRate} disabled={ratingDisabled} focusOnReveal={revealed} />
          <AnalysisPanel noteId={card.note_id} deckId={card.deck_id} provenance={card.provenance} />
        </>
      )}
    </div>
  );
}

function PitchCard({ card, onRate, ratingDisabled }: { card: Extract<StudyCard, { card_type: "pitch" }>; onRate: Props["onRate"]; ratingDisabled?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="card-surface">
      <Media media={card.media} />
      <div className="card-prompt">
        {card.question.furigana ? <Furigana segments={card.question.furigana} /> : card.question.text}
      </div>
      {revealed && <PitchDiagram pitch={card.answer.pitch} morae={card.question.morae} />}
      {!revealed ? (
        <button className="text-input" onClick={() => setRevealed(true)}>
          Show pitch accent
        </button>
      ) : (
        <>
          <RatingRow onRate={onRate} disabled={ratingDisabled} focusOnReveal={revealed} />
          <AnalysisPanel noteId={card.note_id} deckId={card.deck_id} provenance={card.provenance} />
        </>
      )}
    </div>
  );
}

export default function StudyCardView({ card, onRate, ratingDisabled }: Props) {
  switch (card.card_type) {
    case "cloze":
      return <ClozeCard card={card as Extract<StudyCard, { card_type: "cloze" }>} onRate={onRate} ratingDisabled={ratingDisabled} />;
    case "listening":
      return <ListeningCard card={card as Extract<StudyCard, { card_type: "listening" }>} onRate={onRate} ratingDisabled={ratingDisabled} />;
    case "scramble":
      return <ScrambleCard card={card as Extract<StudyCard, { card_type: "scramble" }>} onRate={onRate} ratingDisabled={ratingDisabled} />;
    case "vocab":
      return <VocabCard card={card as Extract<StudyCard, { card_type: "vocab" }>} onRate={onRate} ratingDisabled={ratingDisabled} />;
    case "pitch":
      return <PitchCard card={card as Extract<StudyCard, { card_type: "pitch" }>} onRate={onRate} ratingDisabled={ratingDisabled} />;
    case "basic":
    default:
      return <BasicCard card={card as Extract<StudyCard, { card_type: "basic" }>} onRate={onRate} ratingDisabled={ratingDisabled} />;
  }
}
