CREATE TABLE IF NOT EXISTS decks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A source is one ingested artifact (an uploaded .apkg or textbook file).
-- Every note traces back to exactly one source row, so any generated card
-- can be answered with "where did this come from?" rather than asserted
-- as ground truth with no provenance.
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,             -- 'apkg' | 'textbook' | 'manual'
  filename TEXT NOT NULL,
  hash TEXT,                      -- sha256 of the uploaded file, for de-dup/citation
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  source TEXT NOT NULL,           -- 'apkg' | 'textbook' | 'manual'
  source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  source_location TEXT,           -- JSON: {lesson?, section?, line?, ankiNoteId?, ...}
  fields TEXT NOT NULL,           -- JSON: arbitrary field map (Front/Back/Sentence/Translation...)
  tags TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_source ON notes(source_id);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  card_type TEXT NOT NULL,        -- 'basic' | 'cloze' | 'listening' | 'scramble'
  question TEXT NOT NULL,         -- JSON payload describing prompt (text, cloze index, audio path, words...)
  answer TEXT NOT NULL,           -- JSON payload describing expected answer
  media TEXT NOT NULL DEFAULT '{}', -- JSON: {image?, audio?}

  -- FSRS state
  due TEXT NOT NULL DEFAULT (datetime('now')),
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  elapsed_days REAL NOT NULL DEFAULT 0,
  scheduled_days REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  state INTEGER NOT NULL DEFAULT 0, -- 0=New 1=Learning 2=Review 3=Relearning
  last_review TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-note linguistic analysis, persisted with full provenance so every claim
-- a card makes (this reading, this grammar point) is individually inspectable
-- and correctable later, rather than computed and discarded at card-gen time.
CREATE TABLE IF NOT EXISTS note_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,             -- 'reading' | 'grammar'
  surface TEXT NOT NULL,          -- the analyzed surface span
  label TEXT NOT NULL,            -- reading: chosen reading/'?'; grammar: machine label
  span_start INTEGER,             -- token index range (grammar), nullable
  span_end INTEGER,
  confidence REAL NOT NULL,
  band TEXT NOT NULL,             -- high|medium|low
  needs_review INTEGER NOT NULL DEFAULT 0,
  analyzer_name TEXT,
  analyzer_version TEXT,
  evidence TEXT NOT NULL DEFAULT '[]',      -- JSON Evidence[]
  alternatives TEXT NOT NULL DEFAULT '[]',  -- JSON alternatives
  payload TEXT NOT NULL,          -- JSON: full ReadingDecision / GrammarAnnotation
  corrected_by_user INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_note_analyses_note ON note_analyses(note_id);
CREATE INDEX IF NOT EXISTS idx_note_analyses_review ON note_analyses(needs_review);
CREATE INDEX IF NOT EXISTS idx_note_analyses_label ON note_analyses(kind, label);

CREATE TABLE IF NOT EXISTS review_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,        -- 1=Again 2=Hard 3=Good 4=Easy
  state INTEGER NOT NULL,
  due TEXT NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days REAL NOT NULL,
  last_elapsed_days REAL NOT NULL,
  scheduled_days REAL NOT NULL,
  review TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,            -- 'textbook'
  filename TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | error
  progress INTEGER NOT NULL DEFAULT 0,    -- lessons processed
  total INTEGER NOT NULL DEFAULT 0,       -- lessons detected
  message TEXT NOT NULL DEFAULT '',
  cards_created INTEGER NOT NULL DEFAULT 0,
  result TEXT,                  -- JSON summary (decks created)
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User corrections are first-class data. They take precedence over any
-- analyzer/dictionary output and are reused in future analysis.
CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,          -- 'reading'|'tokenization'|'grammar'|'pitch'|'ocr'|'asr'|'translation'|'field_mapping'
  surface TEXT,                -- surface form being corrected (reading/tokenization/pitch)
  context TEXT,                -- optional scope key (sentence hash, source id, …)
  scope TEXT NOT NULL DEFAULT 'global', -- occurrence|sentence|source|deck|matching|global
  value TEXT NOT NULL,         -- corrected value (e.g. hiragana reading)
  note TEXT,
  source_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_corrections_lookup ON corrections(kind, surface);

CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due);
CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);
CREATE INDEX IF NOT EXISTS idx_cards_note ON cards(note_id);
CREATE INDEX IF NOT EXISTS idx_notes_deck ON notes(deck_id);
CREATE INDEX IF NOT EXISTS idx_review_logs_card ON review_logs(card_id);
