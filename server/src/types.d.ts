declare module "pdf-parse" {
  function pdfParse(buffer: Buffer): Promise<{ text: string }>;
  export default pdfParse;
}

// Optional OCR dependency — not in package.json; install on demand
// (see jobs.ts's extractMediaText, which throws a clear error if missing).
declare module "tesseract.js" {
  export function recognize(
    image: string,
    lang: string
  ): Promise<{ data: { text: string } }>;
}

// Optional ASR dependency — not in package.json; install on demand
// (see jobs.ts's extractMediaText, which throws a clear error if missing).
declare module "whisper-node" {
  function whisper(filePath: string, options?: Record<string, unknown>): Promise<any>;
  export default whisper;
}
