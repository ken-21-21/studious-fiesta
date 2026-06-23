export function parseJsonOrThrow<T>(raw: unknown, fieldName: string): T {
  if (typeof raw !== "string") {
    throw new Error(`${fieldName} missing`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${fieldName} malformed`);
  }
}

export function parseJsonOrDefault<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
