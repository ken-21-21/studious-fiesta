export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Shuffle that retries a few times to avoid returning the original order,
 * so scramble cards aren't accidentally identical to the answer.
 */
export function scrambledOrder<T>(arr: T[], key: (x: T) => string = String): T[] {
  if (arr.length < 2) return arr;
  const original = arr.map(key).join(" ");
  let attempt = shuffle(arr);
  for (let i = 0; i < 6 && attempt.map(key).join(" ") === original; i++) {
    attempt = shuffle(arr);
  }
  return attempt;
}
