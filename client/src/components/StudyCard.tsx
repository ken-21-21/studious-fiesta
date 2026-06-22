import { useEffect, useMemo, useState } from "react";
import {
  fetchNoteAnalysis,
  submitCorrection,
  type CorrectionScope,
  type FuriganaSegment,
  type NoteAnalysis,
  type PitchInfo,
  type StudyCard,
} from "../lib/api";
import "./CardTypes.css";

interface Props {
  card: StudyCard;
  onRate: (rating: 1 | 2 | 3 | 4) => void;
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
    } catch (e: any) {
      setError(e?.message ?? "Failed to submit correction");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="correction-form">
      <input
        className="correction-input"
        placeholder={`Correct reading for "${surface}"`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <select
        className="correction-scope"
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
  const [correctingIdx, setCorrectingIdx] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    fetchNoteAnalysis(noteId)
      .then(setAnalysis)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const toggle = () => {
    if (!open && analysis.length === 0) load();
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
                    {(a.kind === "reading" || a.kind === "grammar") && (
                      <button
                        className="analysis-correct-btn"
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
          <AnalysisPanel noteId={card.note_id} deckId={card.deck_id} provenance={card.provenance} />
        </>
      )}
    </div>
  );
}

// Server-generated cloze blanks come in two forms depending on language:
// ASCII "_____" for English (en.ts's makeEnglishCloze) and full-width
// "＿＿＿" for Japanese (cardgen.ts's BLANK constant). Match either so the
// revealed answer is substituted in place instead of leaving the blank
// on screen forever for JP cloze cards.
const CLOZE_BLANK_RE = /_____|＿＿＿/;

function ClozeCard({ card, onRate }: { card: Extract<StudyCard, { card_type: "cloze" }>; onRate: Props["onRate"] }) {
  const [revealed, setRevealed] = useState(false);
  const display = revealed
    ? card.question.text.replace(CLOZE_BLANK_RE, `[${card.answer.text}]`)
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
          <AnalysisPanel noteId={card.note_id} deckId={card.deck_id} provenance={card.provenance} />
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
          <RatingRow onRate={onRate} />
          <AnalysisPanel noteId={card.note_id} deckId={card.deck_id} provenance={card.provenance} />
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
          <AnalysisPanel noteId={card.note_id} deckId={card.deck_id} provenance={card.provenance} />
        </>
      )}
    </div>
  );
}

function VocabCard({ card, onRate }: { card: Extract<StudyCard, { card_type: "vocab" }>; onRate: Props["onRate"] }) {
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
          <RatingRow onRate={onRate} />
          <AnalysisPanel noteId={card.note_id} deckId={card.deck_id} provenance={card.provenance} />
        </>
      )}
    </div>
  );
}

function PitchCard({ card, onRate }: { card: Extract<StudyCard, { card_type: "pitch" }>; onRate: Props["onRate"] }) {
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
          <RatingRow onRate={onRate} />
          <AnalysisPanel noteId={card.note_id} deckId={card.deck_id} provenance={card.provenance} />
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
    case "vocab":
      return <VocabCard card={card as Extract<StudyCard, { card_type: "vocab" }>} onRate={onRate} />;
    case "pitch":
      return <PitchCard card={card as Extract<StudyCard, { card_type: "pitch" }>} onRate={onRate} />;
    case "basic":
    default:
      return <BasicCard card={card as Extract<StudyCard, { card_type: "basic" }>} onRate={onRate} />;
  }
}
