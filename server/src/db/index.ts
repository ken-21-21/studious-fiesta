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
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
db.exec(schema);
