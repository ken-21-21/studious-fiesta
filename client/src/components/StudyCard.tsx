import { useEffect, useMemo, useState } from "react";
import type { StudyCard } from "../lib/api";
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

function BasicCard({ card, onRate }: Props) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="card-surface">
      <Media media={card.media} />
      <div className="card-prompt">{card.question.text}</div>
      {revealed && <div className="card-answer">{card.answer.text}</div>}
      {!revealed ? (
        <button className="text-input" style={{ cursor: "pointer" }} onClick={() => setRevealed(true)}>
          Show answer
        </button>
      ) : (
        <RatingRow onRate={onRate} />
      )}
    </div>
  );
}

function ClozeCard({ card, onRate }: Props) {
  const [revealed, setRevealed] = useState(false);
  const display = revealed
    ? card.question.text.replace("_____", `[${card.answer.text}]`)
    : card.question.text;
  return (
    <div className="card-surface">
      <Media media={card.media} />
      <div className="card-prompt">{display}</div>
      {!revealed ? (
        <button className="text-input" style={{ cursor: "pointer" }} onClick={() => setRevealed(true)}>
          Show answer
        </button>
      ) : (
        <RatingRow onRate={onRate} />
      )}
    </div>
  );
}

function ListeningCard({ card, onRate }: Props) {
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
        <button className="text-input" style={{ cursor: "pointer" }} onClick={() => setRevealed(true)}>
          Show answer
        </button>
      ) : (
        <RatingRow onRate={onRate} />
      )}
    </div>
  );
}

function ScrambleCard({ card, onRate }: Props) {
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
        <button className="text-input" style={{ cursor: "pointer" }} onClick={() => setRevealed(true)}>
          Check
        </button>
      ) : (
        <RatingRow onRate={onRate} />
      )}
    </div>
  );
}

export default function StudyCardView({ card, onRate }: Props) {
  switch (card.card_type) {
    case "cloze":
      return <ClozeCard card={card} onRate={onRate} />;
    case "listening":
      return <ListeningCard card={card} onRate={onRate} />;
    case "scramble":
      return <ScrambleCard card={card} onRate={onRate} />;
    default:
      return <BasicCard card={card} onRate={onRate} />;
  }
}
