import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dataDir = process.env.DATA_DIR ?? path.resolve(__dirname, "../../data");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, "media"), { recursive: true });

export const DATA_DIR = dataDir;
export const MEDIA_DIR = path.join(dataDir, "media");

export const db = new Database(path.join(dataDir, "app.db"));
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
db.exec(schema);

// `CREATE TABLE IF NOT EXISTS` doesn't add columns to a table that already
// exists from before this column was introduced. Patch older databases
// in place so source provenance survives across app upgrades.
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn("notes", "source_id", "source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL");
ensureColumn("notes", "source_location", "source_location TEXT");
ensureColumn("corrections", "deck_id", "deck_id INTEGER");

// Ensure FTS is populated for existing notes if just created
const ftsCount = db.prepare(`SELECT count(*) as c FROM notes_fts`).get() as { c: number };
if (ftsCount.c === 0) {
  const notesCount = db.prepare(`SELECT count(*) as c FROM notes`).get() as { c: number };
  if (notesCount.c > 0) {
    db.exec(`INSERT INTO notes_fts(notes_fts) VALUES('rebuild')`);
  }
}
