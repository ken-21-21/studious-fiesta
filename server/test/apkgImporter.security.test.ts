import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import initSqlJs from "sql.js";
import { importApkg } from "../src/lib/apkgImporter.js";

// Builds a minimal but structurally valid .apkg: a sql.js collection db with
// one notes row and one cards row, zipped up as collection.anki21.
async function buildCollectionDb(): Promise<Buffer> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE col (id INTEGER PRIMARY KEY, models TEXT);
    CREATE TABLE notes (id INTEGER PRIMARY KEY, mid INTEGER, flds TEXT, tags TEXT);
    CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, ord INTEGER);
    INSERT INTO col (id, models) VALUES (1, '{}');
    INSERT INTO notes (id, mid, flds, tags) VALUES (1, 1, 'front\x1fback', '');
    INSERT INTO cards (id, nid, ord) VALUES (1, 1, 0);
  `);
  const data = Buffer.from(db.export());
  db.close();
  return data;
}

describe("importApkg zip-bomb guard", () => {
  it("rejects an archive whose declared uncompressed size is oversized", async () => {
    const collData = await buildCollectionDb();
    const zip = new AdmZip();
    zip.addFile("collection.anki21", collData);
    // A real oversized media payload would be slow to generate in a test;
    // AdmZip records the *declared* uncompressed size in the local header
    // from the buffer length we pass in, which is exactly what the importer
    // checks before decompressing anything.
    zip.addFile("media", Buffer.from("{}"));
    const huge = Buffer.alloc(1024, 0); // tiny on disk via deflate
    // Patch the entry's header.size after the fact to simulate a zip-bomb
    // style mismatch between compressed size on disk and declared
    // uncompressed size, without actually allocating 200MB+ in the test.
    zip.addFile("0", huge);
    const entries = zip.getEntries();
    const mediaFileEntry = entries.find((e) => e.entryName === "0")!;
    (mediaFileEntry.header as any).size = 500 * 1024 * 1024;

    const tmp = path.join(os.tmpdir(), `zipbomb-${Date.now()}.apkg`);
    fs.writeFileSync(tmp, zip.toBuffer());
    try {
      await expect(importApkg(tmp, "Bomb Deck")).rejects.toThrow(/too large when decompressed/);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("still imports a normal, modestly-sized .apkg", async () => {
    const collData = await buildCollectionDb();
    const zip = new AdmZip();
    zip.addFile("collection.anki21", collData);
    zip.addFile("media", Buffer.from("{}"));

    const tmp = path.join(os.tmpdir(), `normal-${Date.now()}.apkg`);
    fs.writeFileSync(tmp, zip.toBuffer());
    try {
      const result = await importApkg(tmp, "Normal Deck");
      expect(result.cardsImported).toBe(1);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
