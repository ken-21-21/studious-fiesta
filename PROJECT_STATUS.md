# Project Status

A living record of where this project stands. Kept in sync with the GitHub repo
and updated on every change.

- **My branch (Claude):** `claude/science-learning-app-fsrs-xnkrwu` — the
  primary branch; treated as source of truth.
- **Antigravity's branch:** `ANTILOG` — kept mirrored to my branch after every
  push (see `CLAUDE.md` for the sync rule and reconciliation protocol). No
  manually-tracked "last synced commit" anchor anymore — it's derived from
  git (`git merge-base`) since the branches converge after every sync.
- **Last updated:** 2026-06-22
- **Tests:** 61 passing (11 files) · typecheck clean · build clean (server + client)

### Hardening: pitch-data retry backoff + deck/source-scoped re-gating (2026-06-22)
Two gaps found while verifying the previous batch of features:
- **Pitch dataset permanent disable on failure** (`src/lib/jp/pitch.ts`): if
  the one-time Kanjium dataset download ever failed (network blip), pitch
  lookups silently returned `null` for the rest of the process's lifetime —
  no retry was ever attempted again. Added a 60s `retryAfter` cooldown so a
  failed load backs off instead of either retrying on every single word
  lookup (hammering the network) or disabling pitch info forever.
- **Scoped-corrections re-gating gap** (`src/lib/corrections.ts`): `deck`-
  and `source`-scoped corrections were already valid forward-matching
  scopes (`getReadingCorrection`'s `SCOPE_RANK`) but had no retroactive
  back-application path, and `deck` scope couldn't even be persisted — the
  `corrections` table had no `deck_id` column. Fixed by:
  - Adding `corrections.deck_id` (schema + `ensureColumn` migration).
  - Joining `note_analyses` through `notes` to expose `deck_id`/`source_id`,
    then filtering matches to the correction's target deck/source before
    re-gating — so a deck-scoped correction only patches notes in that deck,
    and a source-scoped one only patches notes from that source.
  - Threaded `deckId` through `POST /api/corrections`, the client
    `CorrectionInput` type, and `CorrectionForm`/`AnalysisPanel` in
    `StudyCard.tsx` (new "This deck" scope option in the correction UI).
  - New tests: deck-scoped correction isolated to its deck, no-op when no
    `deckId` given, source-scoped correction isolated to its source.
- **Still intentionally unresolved:** `occurrence`/`sentence` scope remains
  forward-dead in practice (not just retroactively unsupported) — no
  `cardgen.ts` call site threads a `context` string (sentence/occurrence key)
  into `tokenize()`, so `getReadingCorrection`'s context-matching branch for
  those two scopes never has anything to match against today. Fixing this
  requires plumbing sentence/position context through the whole generation
  pipeline; deferred as a larger follow-up rather than bundled into this
  hardening pass.

### Manual add-card flow (2026-06-22)
The only way to get content in was bulk import (apkg or textbook) — no way
to quickly jot down a single word/card. Added `POST /api/notes`
(`server/src/routes/notes.ts`): takes `front`/`back` (+ optional `deckId` or
`deckName`), creates a deck if needed, inserts a `manual`-sourced note and a
plain `basic` card with fresh FSRS defaults. Deliberately makes no reading/
pitch claims — same shape as an apkg "basic" card — so it carries nothing
that needs gating under the JP-analysis invariant; if the user types
Japanese, it's taken as their own settled spelling/reading, not an inferred
one. Client: new `/add` page (`AddCard.tsx`) with deck picker/new-deck-name,
front/back inputs, and "Add & add another" / "Add & study" actions.

### Phase B+: corrections ↔ analysis re-gating loop (2026-06-22)
Closes the last open item on Phase B+: submitting a correction previously
only affected *future* analysis runs (via `getReadingCorrection`, already
wired into `readings.ts`) — existing `note_analyses` rows and the cards
already generated from them stayed stale and still showed `needsReview`,
so a user-corrected reading wasn't reflected anywhere they'd actually see it.
- `reGateExistingAnalyses()` (`server/src/lib/corrections.ts`), called from
  `POST /api/corrections`: for `reading`/`grammar` corrections with `global`
  or `matching` scope, finds existing `note_analyses` rows with the same
  kind+surface, marks them `corrected_by_user = 1`, sets `confidence = 1`,
  `band = 'high'`, `needs_review = 0`, and folds the prior label into
  `alternatives` so the override is still inspectable, not just silently
  swapped.
- For notes with a re-gated analysis, also rewrites the stored `question`/
  `answer` JSON of their cards in place wherever a payload's `text` is
  *exactly* the corrected surface (whole-term match only, never a substring
  guess) or a `furigana` segment matches it — so the flashcard itself stops
  showing the wrong reading, not just the analysis panel.
- **Known, intentional limitation:** scoped corrections
  (occurrence/sentence/source/deck) are *not* back-applied to existing rows,
  because `note_analyses` doesn't retroactively store the context
  (sentence/source key) `getReadingCorrection` matches against — back-
  applying them would risk silently overwriting an unrelated occurrence of
  the same surface. They still apply correctly to all *future* analysis via
  the existing forward path. This is a deliberate "don't guess" choice
  consistent with the core invariant, not an oversight.
- **Also intentionally out of scope:** a correction can't retroactively
  *create* a card that was never generated because the old, lower-confidence
  reading gated it out (e.g. a listening/pitch card that never existed for a
  `needsReview` vocab entry). Doing that safely requires re-running the full
  textbook/apkg ingestion pipeline for the affected note, which risks
  duplicating cards or losing FSRS review history — not attempted here.
  Candidate for a real "re-import this note" flow later if it matters in
  practice.
- New tests in `corrections.test.ts` cover both the re-gating path (analysis
  + card payload updated) and the scoped-correction non-back-application
  path.

### Hardening: apkg zip-bomb guard (2026-06-22)
`apkgImporter.ts` now checks `entry.header.size` (the zip's *declared*
uncompressed size, read from header metadata without decompressing) against a
200MB per-entry / 1GB total cap before any entry is decompressed. Closes a gap
where multer's upload-size limit only bounded the compressed `.apkg` on disk —
a small crafted archive could otherwise decompress to gigabytes and exhaust
memory. New test file `apkgImporter.security.test.ts` covers both the
rejection path and the (still-functional) normal-import path.

### Client: vocab/pitch card rendering fix (2026-06-22)
The server's `CardType` union (`vocab | cloze | scramble | listening | pitch`,
`cardgen.ts`) was only partially modeled on the client — `StudyCard` in
`client/src/lib/api.ts` had no `"vocab"`/`"pitch"` variants, so both silently
rendered via the generic `BasicCard`. For `pitch` cards this was a real bug,
not just a display nicety: a pitch card's `answer` is `{ pitch: PitchInfo }`
with no `.text` field at all, so the "answer" rendered blank — pitch cards
were non-functional in the UI.
- Added `"vocab"` and `"pitch"` variants to `StudyCard` with the real field
  shapes from `cardgen.ts` (`furigana`, `reading`, `readingUncertain`,
  `readingAlternatives`, `morae`, `pitch`, `lang`, `prompt`).
- Added a `Furigana` component (`<ruby>`/`<rt>`) — this is the first place in
  the client that renders furigana at all, even though `ClozeCard` and others
  have carried `furigana` data since the provenance UI landed. Readings the
  analyzer couldn't confirm (`uncertain: true`) render with a visible `?` and
  warning color rather than being presented as settled fact.
- Added a `PitchDiagram` component rendering `PitchInfo`'s per-mora H/L
  pattern as a step diagram, plus the accent type and following-particle
  pitch.
- Added `VocabCard` and `PitchCard` components wired into `StudyCardView`'s
  switch in place of the old `default: BasicCard` fallback for those two
  types.
- Verified via `tsc -b && vite build` (client) and the full server gate
  (typecheck/test/build) — no live browser available in this container, so
  visual rendering was not screenshot-verified.

### Reconciliation note (2026-06-22, ANTILOG → mine, round 2)
Evaluated 4 more commits from `ANTILOG` (`61391df`→`b626995`): backend
hardening, all kept:
- **Kept:** file hashing now streams (`createReadStream` → hash) instead of
  `readFileSync`-ing the whole file into memory, in both the apkg importer
  and the textbook job pipeline; large apkg imports are now chunked into
  500-row transactions instead of one giant transaction; the study queue's
  N+1 per-card note/provenance lookup replaced with a single JOIN query.
  All are straightforward correctness/scalability fixes with no invariant
  or locked-decision conflicts.
- **Also fixed in this pass:** the redesign CSS from the prior reconciliation
  round references `--glass-bg`, `--glass-border`, `--shadow-md`, `--danger`,
  `--success`, `--warning`, `--info` that were never defined in `:root` —
  without them the four study rating buttons (Again/Hard/Good/Easy) rendered
  white-on-transparent (invisible) and glass panels lost their tint/border/
  shadow. Added the missing token definitions to `index.css`.

### Reconciliation note (2026-06-22, ANTILOG → mine, round 1)
Evaluated 6 commits from `ANTILOG` (latest `61391df`). Kept nearly everything;
it strengthened the core invariant rather than weakening it:
- **Kept:** cloze/scramble cards now gate uncertain readings the same way
  vocab cards already did (`cardgen.ts`) — closes a real gap; English cloze
  now blanks the *correct* occurrence of a repeated word (`en.ts`); a global
  Express error handler (`index.ts`); new test coverage (`pitch.test.ts`,
  `en.test.ts`); client-side provenance/analysis UI — `AnalysisPanel`,
  `fetchNoteAnalysis`, `Provenance`/`NoteAnalysis` types (Phase F, previously
  unstarted); a full visual redesign (`index.css`, `CardTypes.css`,
  `Loaders.tsx`, nav links, skeleton loaders) — checked for suspicious
  external content, found none beyond a Google Fonts `@import`.
- **Dropped:** `server/scratch.js` — a throwaway debug script, not app code.
- **Fixed during merge:** `cardgen.gating.test.ts`'s new sentence-cloze test
  asserted the wrong target word for `pickJpClozeIndex`'s middle-of-content
  selection on its original example sentence — changed the fixture sentence
  so the test still exercises the intended gating path; removed an unused
  `import React` in `Loaders.tsx` that broke the client build under the new
  JSX transform.
- **Known pre-existing gap, not introduced by this change:** `StudyCard`'s
  discriminated union in `client/src/lib/api.ts` still doesn't cover
  `"vocab"`/`"pitch"` card types from `cardgen.ts`. Left as-is; candidate for
  a follow-up.

---

## What this is

A personal-use (not multi-tenant) science-based Japanese/English study app.
Drop in Anki `.apkg` decks or textbook text/PDF; it generates FSRS-scheduled
cards (vocab, cloze, scramble, listening, pitch). The Japanese pipeline's core
invariant: **never silently teach wrong Japanese** — uncertain analysis is
marked, gated out of study material, traceable to evidence, and correctable.

## Stack

- **Server:** Node + TypeScript + Express + better-sqlite3 (WAL, FK on), FSRS via `ts-fsrs`.
- **Client:** React + TypeScript + Vite. *(Not yet updated to surface provenance/analysis.)*
- **JP NLP:** kuromoji (IPADIC) morphology, kanjium pitch-accent data, mora theory.
- **EN NLP:** wink-nlp for cloze/POS.

---

## Architecture (server)

| Area | Files |
|------|-------|
| DB + migrations | `src/db/index.ts`, `src/db/schema.sql` |
| FSRS scheduling | `src/lib/fsrs.ts` |
| Anki import | `src/lib/apkgImporter.ts` |
| Textbook background jobs | `src/lib/jobs.ts`, `src/lib/segment.ts` |
| Card generation | `src/lib/cardgen.ts`, `src/lib/en.ts`, `src/lib/shuffle.ts`, `src/lib/lang.ts` |
| JP analysis core | `src/lib/jp/analyzer.ts`, `tokenizer.ts`, `readings.ts`, `types.ts`, `ambiguous.ts` |
| JP grammar layer | `src/lib/jp/grammar.ts`, `aspect.ts` |
| JP phonology | `src/lib/jp/kana.ts`, `morae.ts`, `pitch.ts`, `colloquial.ts` |
| Provenance records | `src/lib/jp/analysisRecord.ts` |
| Corrections | `src/lib/corrections.ts`, `src/routes/corrections.ts` |
| HTTP routes | `src/routes/{decks,imports,study,sources,notes,corrections}.ts` |

### Key design principles
- Every reading/grammar claim carries **evidence**, **confidence**, a **band**
  (high/medium/low) and **alternatives** (`src/lib/jp/types.ts`).
- Low-confidence readings are **gated** from reading-dependent cards
  (production/listening/pitch) — only the meaning card survives.
- User corrections are first-class and override analyzer output, scoped
  `occurrence > sentence > source > deck > matching > global`.
- Every note traces back to a `sources` row + `source_location`, and every
  card's linguistic claims are persisted in `note_analyses`.

### Database tables
`decks`, `notes`, `cards`, `review_logs`, `import_jobs`, `corrections`,
`sources` (provenance), `note_analyses` (per-note reading/grammar provenance).
Older DBs are migrated in place via `ensureColumn` in `src/db/index.ts`.

### HTTP API
- `GET/DELETE /api/decks`
- `POST /api/import/apkg`, `POST /api/import/textbook` (→ jobId), `GET /api/import/jobs/:id`
- `GET /api/study/queue`, `POST /api/study/cards/:id/review`
- `POST /api/corrections`
- `GET /api/sources`, `GET /api/sources/:id`
- `GET /api/notes/:id/analysis`
- `GET /api/health`

---

## Roadmap & progress

| Phase | Description | Status |
|-------|-------------|--------|
| — | FSRS app + apkg/textbook import + card types | ✅ Done |
| — | Quality hardening of import/study/review endpoints | ✅ Done |
| A | JP pipeline: confidence, evidence, ambiguity KB, gating, corrections | ✅ Done |
| C | Explicit, inspectable grammar annotation layer | ✅ Done |
| B | Provenance persistence (sources + note_analyses), grammar wired into ingestion | ✅ Done |
| B+ | Corrections ↔ analysis loop (mark `corrected_by_user`, re-gate affected cards) | ✅ Done (global/matching/deck/source scope; occurrence/sentence intentionally forward-only, see hardening note) |
| D | Ingestion breadth: OCR (tesseract.js), ASR (whisper), EPUB, subtitles | ⬜ Planned |
| E | Source-grounded Q&A (Claude API) + search/retrieval indexes | ⬜ Planned |
| F | Client UI: surface confidence/evidence/grammar, correction & review UI | 🔶 Started (provenance/analysis panel via ANTILOG) |
| — | Anki field-role inference (japanese/reading/meaning/audio/…) with confidence | ⬜ Planned |

**Decisions locked in:** OCR/ASR = local OSS (tesseract.js / whisper); Q&A LLM =
Claude API; personal-use only (no multi-tenant/marketplace/sharing); no
preloaded curriculum; do not rewrite from scratch.

---

## How to run

```bash
cd server && npm install && npm run dev    # http://localhost:8787
cd client && npm install && npm run dev    # http://localhost:5173
```

Quality gates: `npm run typecheck`, `npm test`, `npm run build` (all in `server/`).

---

## Notes for maintainers
- This file is updated whenever the repo changes; the top section reflects
  current state, not a point-in-time snapshot.
- The remote execution environment is ephemeral — only committed files survive,
  which is why this status lives in the repo rather than as an untracked file.
- **Two agents edit this repo** (Claude + Antigravity). See `CLAUDE.md` for the
  reconciliation protocol. Claude's commits are authored `Claude
  <noreply@anthropic.com>`; anything else on `ANTILOG` since the last
  `git merge-base` with my branch is an external change to reconcile.
