export function normalizeText(text: string): string {
  // Strip zero-width characters (e.g., ZWSP, ZWNJ, ZWJ) and other invisible format chars
  let out = text.replace(/[\u200B-\u200D\uFEFF]/g, "");

  // Convert full-width alphanumeric to half-width
  out = out.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));

  // Half-width katakana to full-width
  const hwKanaMap: Record<string, string> = {
    '\uFF66': '\u30F2', '\uFF67': '\u30A1', '\uFF68': '\u30A3', '\uFF69': '\u30A5', '\uFF6A': '\u30A7',
    '\uFF6B': '\u30A9', '\uFF6C': '\u30E3', '\uFF6D': '\u30E5', '\uFF6E': '\u30E7', '\uFF6F': '\u30C3',
    '\uFF70': '\u30FC', '\uFF71': '\u30A2', '\uFF72': '\u30A4', '\uFF73': '\u30A6', '\uFF74': '\u30A8',
    '\uFF75': '\u30AA', '\uFF76': '\u30AB', '\uFF77': '\u30AD', '\uFF78': '\u30AF', '\uFF79': '\u30B1',
    '\uFF7A': '\u30B3', '\uFF7B': '\u30B5', '\uFF7C': '\u30B7', '\uFF7D': '\u30B9', '\uFF7E': '\u30BB',
    '\uFF7F': '\u30BD', '\uFF80': '\u30BF', '\uFF81': '\u30C1', '\uFF82': '\u30C4', '\uFF83': '\u30C6',
    '\uFF84': '\u30C8', '\uFF85': '\u30CA', '\uFF86': '\u30CB', '\uFF87': '\u30CC', '\uFF88': '\u30CD',
    '\uFF89': '\u30CE', '\uFF8A': '\u30CF', '\uFF8B': '\u30D2', '\uFF8C': '\u30D5', '\uFF8D': '\u30D8',
    '\uFF8E': '\u30DB', '\uFF8F': '\u30DE', '\uFF90': '\u30DF', '\uFF91': '\u30E0', '\uFF92': '\u30E1',
    '\uFF93': '\u30E2', '\uFF94': '\u30E4', '\uFF95': '\u30E6', '\uFF96': '\u30E8', '\uFF97': '\u30E9',
    '\uFF98': '\u30EA', '\uFF99': '\u30EB', '\uFF9A': '\u30EC', '\uFF9B': '\u30ED', '\uFF9C': '\u30EF',
    '\uFF9D': '\u30F3', '\uFF9E': '\u309B', '\uFF9F': '\u309C'
  };

  out = out.replace(/[\uFF66-\uFF9F]/g, (ch) => hwKanaMap[ch] || ch);

  // Convert voiced/semi-voiced combined with full-width katakana
  out = out.normalize("NFC");

  return out;
}
