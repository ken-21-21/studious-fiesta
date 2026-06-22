import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";

const nlp = winkNLP(model);
const its = nlp.its as any;

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "to", "of",
  "and", "in", "on", "at", "for", "with", "as", "it", "this", "that",
  "i", "you", "he", "she", "we", "they", "do", "does", "did",
]);

/** Choose a content word (noun/verb/adj) near the middle to blank for a cloze. */
export function pickClozeWord(sentence: string): { word: string; index: number } | null {
  const doc = nlp.readDoc(sentence);
  const tokens = doc.tokens().out(its.value) as string[];
  const pos = doc.tokens().out(its.pos) as string[];
  const candidates: { word: string; index: number }[] = [];
  tokens.forEach((tok, i) => {
    const tag = pos[i];
    const lower = tok.toLowerCase();
    if ((tag === "NOUN" || tag === "VERB" || tag === "ADJ") && tok.length > 2 && !STOPWORDS.has(lower)) {
      candidates.push({ word: tok, index: i });
    }
  });
  if (!candidates.length) return null;
  return candidates[Math.floor(candidates.length / 2)];
}

export function makeEnglishCloze(sentence: string): { text: string; answer: string } | null {
  const pick = pickClozeWord(sentence);
  if (!pick) return null;

  const doc = nlp.readDoc(sentence);
  const tokens = doc.tokens().out(its.value) as string[];
  
  let occurrence = 0;
  for (let i = 0; i < pick.index; i++) {
    if (tokens[i] === pick.word) occurrence++;
  }

  const escaped = pick.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "g");
  let text = sentence;
  let currentOccurrence = 0;
  let match;
  
  while ((match = re.exec(sentence)) !== null) {
    if (currentOccurrence === occurrence) {
      text = sentence.substring(0, match.index) + "_____" + sentence.substring(match.index + pick.word.length);
      break;
    }
    currentOccurrence++;
  }

  if (text === sentence) {
    const fallbackRe = new RegExp(`\\b${escaped}\\b`);
    text = sentence.replace(fallbackRe, "_____");
  }

  if (text === sentence) return null;
  return { text, answer: pick.word };
}
