import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "../src/db/index.js";
import { createTextbookJob, getJob } from "../src/lib/jobs.js";

async function waitForJob(id: number, tries = 200): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const job = getJob(id) as any;
    if (job.status === "done" || job.status === "error") return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("job did not finish in time");
}

describe("source provenance on textbook ingestion", () => {
  it("creates a source row and links every generated note back to it", async () => {
    const tmp = path.join(os.tmpdir(), `provenance-${Date.now()}.txt`);
    fs.writeFileSync(
      tmp,
      ["Lesson 1: Test", "Vocabulary", "学校 がっこう school", "先生 せんせい teacher"].join("\n"),
      "utf-8"
    );

    const jobId = createTextbookJob(tmp, "provenance-fixture.txt", "Provenance Test Deck");
    const job = await waitForJob(jobId);
    expect(job.status).toBe("done");

    const source = db
      .prepare("SELECT * FROM sources WHERE filename = ?")
      .get("provenance-fixture.txt") as any;
    expect(source).toBeTruthy();
    expect(source.kind).toBe("textbook");
    expect(source.hash).toBeTruthy();

    const notes = db.prepare("SELECT * FROM notes WHERE source_id = ?").all(source.id) as any[];
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(note.source_id).toBe(source.id);
      expect(JSON.parse(note.source_location)).toHaveProperty("label");
    }
  });
});
