import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate every test run in a throwaway data dir so the real app DB is never
// touched and the schema is created fresh.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsrs-test-"));
fs.mkdirSync(path.join(dir, "media"), { recursive: true });
process.env.DATA_DIR = dir;

// Seed a tiny offline pitch-accent dataset so pitch-dependent tests are
// deterministic and never hit the network.
// 上手 is a genuine multi-reading homograph (じょうず vs うわて), used to
// verify lookupPitch() doesn't guess a homograph's pattern when the caller's
// reading doesn't match any candidate for that headword.
const accents = [
  "学校\tがっこう\t0",
  "先生\tせんせい\t3",
  "箸\tはし\t1",
  "橋\tはし\t2",
  "上手\tじょうず\t3",
  "上手\tうわて\t0",
].join("\n");
fs.writeFileSync(path.join(dir, "accents.txt"), accents);
