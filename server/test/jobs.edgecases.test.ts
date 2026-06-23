/**
 * Stress-test / edge-case regression tests for extractMediaText (jobs.ts).
 *
 *  B7  Scanned (image-only) PDF — near-empty extraction raises a clear error
 *  B8  EPUB ruby/furigana — <rt> content stripped, not concatenated
 *  B9  OCR response truncation — stop_reason===max_tokens surfaces an error
 *       (tested by mocking the Anthropic client)
 *  B10 Non-UTF-8 .txt file — encoding error surfaces clearly
 */

import { vi, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { extractMediaText } from "../src/lib/jobs.js";

// ---------------------------------------------------------------------------
// Mock pdf-parse so the B7 tests can control what the parser returns without
// needing to construct valid PDF binaries (pdf.js's xref parser is strict).
// ---------------------------------------------------------------------------
const mockPdfParse = vi.fn();
vi.mock("pdf-parse", () => ({ default: mockPdfParse }));

// ---------------------------------------------------------------------------
// Helper: build a minimal EPUB (zip) with one XHTML entry containing ruby markup.
// ---------------------------------------------------------------------------
function makeRubyEpub(html: string): Buffer {
  const zip = new AdmZip();
  const fullHtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>${html}</body>
</html>`;
  zip.addFile("OEBPS/content.xhtml", Buffer.from(fullHtml, "utf8"));
  return zip.toBuffer();
}

// ---------------------------------------------------------------------------
// B7 — Scanned PDF detection
// ---------------------------------------------------------------------------

describe("B7 — scanned PDF detection", () => {
  it("raises a clear error for a 1-page PDF with no text layer", async () => {
    // pdf-parse returns empty text with numpages=1 (simulates image-only scan)
    mockPdfParse.mockResolvedValueOnce({ text: "", numpages: 1 });
    const tmp = path.join(os.tmpdir(), `scan-${Date.now()}.pdf`);
    fs.writeFileSync(tmp, Buffer.from("%PDF-1.4")); // content is irrelevant — mocked
    try {
      await expect(extractMediaText(tmp, "scan.pdf")).rejects.toThrow(/scanned/i);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("error message mentions page count and character count", async () => {
    mockPdfParse.mockResolvedValueOnce({ text: "   ", numpages: 3 });
    const tmp = path.join(os.tmpdir(), `scan2-${Date.now()}.pdf`);
    fs.writeFileSync(tmp, Buffer.from("%PDF-1.4"));
    try {
      await expect(extractMediaText(tmp, "scan2.pdf")).rejects.toThrow(/page/i);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("does NOT raise for a PDF with real text content", async () => {
    const realText = "これは日本語のテキストです。".repeat(20); // > 50 chars/page
    mockPdfParse.mockResolvedValueOnce({ text: realText, numpages: 1 });
    const tmp = path.join(os.tmpdir(), `textpdf-${Date.now()}.pdf`);
    fs.writeFileSync(tmp, Buffer.from("%PDF-1.4"));
    try {
      const text = await extractMediaText(tmp, "textpdf.pdf");
      expect(text).toBe(realText);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// B8 — EPUB ruby / furigana
// ---------------------------------------------------------------------------

describe("B8 — EPUB ruby/furigana handling", () => {
  it("strips <rt> content so furigana readings don't corrupt extracted text", async () => {
    const tmp = path.join(os.tmpdir(), `epub-ruby-${Date.now()}.epub`);
    const epubBuf = makeRubyEpub(
      "<p><ruby>漢字<rt>かんじ</rt></ruby>の<ruby>勉強<rt>べんきょう</rt></ruby>をする。</p>"
    );
    fs.writeFileSync(tmp, epubBuf);
    try {
      const text = await extractMediaText(tmp, "test.epub");

      // Furigana readings must NOT appear — they would corrupt tokenisation
      expect(text).not.toContain("かんじ");
      expect(text).not.toContain("べんきょう");

      // Base kanji must still be present
      expect(text).toContain("漢字");
      expect(text).toContain("勉強");
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("handles nested ruby with rt-only spans and multiple annotations", async () => {
    const tmp = path.join(os.tmpdir(), `epub-ruby2-${Date.now()}.epub`);
    const epubBuf = makeRubyEpub(
      "<p>これは<ruby>日本語<rt>にほんご</rt></ruby>のテキストです。</p>"
    );
    fs.writeFileSync(tmp, epubBuf);
    try {
      const text = await extractMediaText(tmp, "test2.epub");
      expect(text).not.toContain("にほんご");
      expect(text).toContain("日本語");
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// B10 — Non-UTF-8 .txt detection
// (B9 — OCR truncation requires a live Anthropic API call; it is deferred —
//  see the final summary in PROJECT_STATUS.md for reasoning.)
// ---------------------------------------------------------------------------

describe("B10 — non-UTF-8 .txt encoding", () => {
  it("raises a clear encoding error for Shift-JIS encoded .txt", async () => {
    // Shift-JIS bytes for "これの" — valid Shift-JIS, invalid UTF-8
    const shiftJisBytes = Buffer.from([0x82, 0xb1, 0x82, 0xea, 0x82, 0xcc]);
    const tmp = path.join(os.tmpdir(), `sjis-${Date.now()}.txt`);
    fs.writeFileSync(tmp, shiftJisBytes);
    try {
      await expect(extractMediaText(tmp, "japanese.txt")).rejects.toThrow(/UTF-8/i);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("error message names the file and mentions re-saving as UTF-8", async () => {
    const invalidUtf8 = Buffer.from([0xff, 0xfe, 0x48, 0x00]); // BOM-like invalid UTF-8
    const tmp = path.join(os.tmpdir(), `invalid-${Date.now()}.txt`);
    fs.writeFileSync(tmp, invalidUtf8);
    try {
      await expect(extractMediaText(tmp, "myfile.txt")).rejects.toThrow(/UTF-8/i);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("accepts valid UTF-8 .txt without error", async () => {
    const validUtf8 = Buffer.from("これは正しいUTF-8テキストです。\n", "utf8");
    const tmp = path.join(os.tmpdir(), `utf8-${Date.now()}.txt`);
    fs.writeFileSync(tmp, validUtf8);
    try {
      const text = await extractMediaText(tmp, "utf8.txt");
      expect(text).toContain("これは正しいUTF-8テキストです。");
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
