# FSRS Learn

A self-hosted spaced-repetition app for language acquisition. Import Anki `.apkg`
decks or raw textbook text/PDF, and study with FSRS-scheduled cards across
multiple question types: basic recall, cloze deletion, listening dictation,
and sentence scramble.

## Stack

- **Server**: Node.js + TypeScript + Express + better-sqlite3, scheduling via
  [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs).
- **Client**: React + TypeScript + Vite.
- Apkg files are parsed directly (zip + embedded SQLite collection) with
  [`sql.js`](https://github.com/sql-js/sql.js); media is extracted and served
  from `/media`.
- Textbook import splits text into sentences (`wink-nlp`), auto-generates
  cloze blanks (noun/verb/adjective masking), scrambled-word cards, and
  listening cards (browser TTS via the Web Speech API, or bundled audio if
  present).

## Local development

```bash
# terminal 1
cd server && npm install && npm run dev    # http://localhost:8787

# terminal 2
cd client && npm install && npm run dev    # http://localhost:5173 (proxies /api, /media)
```

## Self-hosted deployment (Docker)

```bash
docker compose up -d --build
```

This builds the client, bundles it behind the Express server, and persists
the SQLite database + media files in a Docker volume at `/app/data`. The app
is served on port `8787`.

## How importing works

- **`.apkg`**: Upload via the Import page. Notes/cards/media are extracted
  from the Anki collection and inserted as `basic` cards, each card type
  carrying over its first image/audio reference. Cards start as new FSRS
  cards (no scheduling history is preserved from Anki).
- **Textbook (`.txt` / `.pdf`)**: Text is split into sentences; each sentence
  produces a cloze card (key word blanked), a scramble card (reorder shuffled
  words back into the sentence), and a listening card (TTS playback + typed
  recall). Capped at 400 sentences per import to keep imports fast.

## FSRS scheduling

Every card carries its own FSRS state (`stability`, `difficulty`, `due`,
etc.). Grading a card (`Again`/`Hard`/`Good`/`Easy`) calls `ts-fsrs`'s
`next()` scheduler and persists both the updated card state and a
`review_logs` row for history/analytics.
