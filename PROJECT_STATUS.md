# Project Status

A living record of where this project stands. Kept in sync with the GitHub repo
and updated on every change.

- **My branch (Claude):** `claude/science-learning-app-fsrs-xnkrwu` — the
  primary branch; treated as source of truth.
- **Antigravity's branch:** `ANTILOG` — kept mirrored to my branch after every
  push (see `CLAUDE.md` for the sync rule and reconciliation protocol). No
  manually-tracked "last synced commit" anchor anymore — it's derived from
  git (`git merge-base`) since the branches converge after every sync.
- **Last updated:** 2026-06-23
- **Tests:** 210 passing (23 files) · typecheck clean · build clean (server + client)

### apkg import: Japanese-content notes routed through analysis/cardgen pipeline (2026-06-23)
- **Root-cause fix:** `colStmt.get()` in sql.js requires `step()` to be called first;
  without it the `col.models` value was always `undefined`, leaving `modelFieldMap`
  empty for every import. Added the missing `colStmt.step()` call before `get()`.
- **`isJapaneseDeck` flag:** Added to `FieldMapping`. Set to `true` only when
  field-name or sample-content inference positively identifies a Japanese field
  (not when the always-applied fallback of index 0 is the only evidence).
- **Analysis pipeline wiring (`apkgImporter.ts`):**
  - For each chunk of notes, a new async `analyzeJapaneseRows()` phase runs
    **before** the DB transaction, calling `vocabNote({ term, gloss })` for every
    note whose model is flagged `isJapaneseDeck`. The Anki deck's Reading field
    is intentionally NOT passed as the `reading` argument — kuromoji's confidence
    pipeline determines the reading independently so uncertain readings are gated
    the same way textbook imports are (no silently asserted wrong reading).
  - The sync `persistChunk` DB transaction then uses the pre-computed `NoteSpec`
    for Japanese notes: writes `note_analyses` rows with full provenance, generates
    vocab/listening/pitch cards gated by reading confidence, and stores merged
    fields including `Term`/`Reading`/`Gloss` for future `createNewlyEnabledCards`
    compatibility.
  - Non-Japanese decks (no `isJapaneseDeck` evidence) take the unchanged basic-card
    path: single basic card, no analysis, zero behavior change.
- **Tests:** `server/test/apkgImporter.analysis.test.ts` (4 new tests):
  - Japanese vocab deck → `note_analyses` row written, `vocab` card generated.
  - Confident reading → `listening` card generated (reading clears confidence gate).
  - English-only deck → single basic card, no `note_analyses`, unchanged behavior.
  - Ambiguous term ("生物") → `needs_review` tag, listening/pitch withheld, vocab card present.

### Furigana okurigana splitting + ClozeCard/ScrambleCard rendering (2026-06-23)
- **Okurigana split fix (server):** Added `splitOkurigana(surface, reading)` helper to
  `server/src/lib/jp/tokenizer.ts` implementing the standard suffix/prefix alignment
  algorithm. Ruby annotation now only covers the kanji run; kana okurigana (e.g. `べる`
  in `食べる`) and honorific prefixes (e.g. `お` in `お茶`) are emitted as plain text
  segments. Uncertain tokens (needsReview) are preserved as whole-token `uncertain: true`
  segments — uncertainty gating takes priority over splitting. Both `toFuriganaSegments`
  and `furiganaOf` now use `flatMap` + `splitOkurigana`. Tests: `server/test/furigana.test.ts`
  (10 new tests: pure-kanji, trailing okurigana, leading prefix, fallback, mismatch,
  uncertain-token, end-to-end confidence check).
- **ClozeCard furigana (client):** Front now renders `question.furigana` via the
  `Furigana` component. Back shows the full question furigana (sentence context with
  blank) plus the answer word with its own furigana/uncertainty marker. English cloze
  cards (no furigana field) fall through to plain text.
- **ScrambleCard furigana (client):** Server now emits `answer.wordFurigana:
  FuriganaSegment[][]` (per-word segment arrays). Revealed correct-order answer on the
  back now renders each word with its furigana via inline ruby markup; falls back to
  plain text join if `wordFurigana` is absent.
- **CSS consolidation (client):** Removed the duplicate global `ruby/rt` block
  (lines 488–504 of `CardTypes.css`). All ruby-styling properties merged into the
  already-scoped `.furigana-line ruby/.furigana-line rt` rules; no behavior change.

### OCR/ASR moved to cloud APIs (2026-06-23)
**Decision change:** OCR and ASR have moved from local-OSS to cloud API calls.
- **OCR** (`.png`, `.jpg`, `.jpeg`, `.webp`): now calls Claude Haiku vision
  (`claude-haiku-4-5`) via the Anthropic API — pure transcription prompt,
  no local tesseract.js dependency.
- **ASR** (`.mp3`, `.wav`, `.m4a`, `.mp4`): now calls OpenAI
  `gpt-4o-mini-transcribe` via `POST /v1/audio/transcriptions` with
  `language: "ja"` — no local whisper-node dependency.
- **`OPENAI_API_KEY`** is now a required env var for audio imports (alongside
  the existing `ANTHROPIC_API_KEY` required for Q&A and OCR). See
  `server/.env.example` for documentation of both keys.
- Removed stale `tesseract.js` and `whisper-node` module declarations from
  `server/src/types.d.ts`.

### P0/P1 implementation pass: reliability, guardrails, CI, explainability (2026-06-23)
- Reliability/coverage expansion:
  - `imports.route.test.ts`: added high-volume `.apkg` import validation (120 notes),
    noisy subtitle (`.vtt`) import polling to terminal state, and larger noisy `.txt`
    import completion checks.
  - `study.route.test.ts`: added long sequential review-session regression (45 cards,
    all persisted with `reps > 0`).
  - `backup.test.ts`: added linked-data snapshot integrity assertion across
    `sources`/`notes`/`cards`/`note_analyses`/`review_logs`, plus backup-route
    failure behavior (`db.backup` rejection → HTTP 500).
- Japanese guardrail tightening:
  - `POST /api/corrections` now normalizes control characters from string inputs
    and enforces kana-only payloads for `kind=reading` corrections to prevent
    invalid reading overrides from being promoted into learning content.
  - Added route tests covering non-kana rejection and normalization behavior.
- CI discipline:
  - Added `.github/workflows/ci.yml` to enforce server gates (`typecheck`, `test`,
    `build`) and client gates (`lint`, `build`) on PRs and tracked branches.
- Explainability + UX polish:
  - Study analysis panel now surfaces a plain-language uncertainty hint,
    explicit `Needs review` badges, and compact evidence summaries.
  - Study header now shows both remaining and reviewed counts; import flow now
    clarifies next-step outcome and uses clearer call-to-action copy.
- Observability baseline:
  - Added structured latency/outcome logging for `/api/qa` and correction re-gating
    summaries in `/api/corrections`.

### Apple-level polish: animations + interactivity (2026-06-23)
- Added higher-fidelity navigation and motion polish:
  - Header now animates into view on mount.
  - Top-nav uses active-state pills (`NavLink`) with underline reveal and accent
    highlighting for current route.
- Added list microinteractions on Decks:
  - Deck rows now animate in with subtle staggered entry.
  - Pointer interactions now get gentle hover lift + tap feedback.
- Added motion accessibility guardrails:
  - Global `prefers-reduced-motion` override now minimizes animations/transitions
    and disables hover transforms.
  - Decks page respects reduced-motion preference for framer-motion initial/hover
    states.
- Added keyboard-focus polish:
  - Consistent `:focus-visible` ring and accent border across links/buttons/inputs.

### Frontend wiring + responsive polish (2026-06-23)
- Fixed client wiring/lint issues that could hide stale state races or weaken type
  safety:
  - `Decks.tsx` and `Study.tsx` now trigger `loading/error` resets from explicit
    reload actions instead of synchronous state writes inside effect bodies.
  - `Study.tsx` now keys the active study session by `deckId`, so queue/review
    state resets cleanly when switching decks.
  - `StudyCard.tsx` now removes a remaining `any` catch branch and memoizes
    listening-card playback handler to satisfy effect-dependency correctness.
- Improved mobile/small-screen scaling:
  - Header nav links now use direct link-buttons (no nested button-in-link
    controls).
  - Deck list rows/actions now stack and wrap safely on narrow viewports.
  - Study analysis rows now wrap cleanly, and pitch-diagram tracks now scroll
    horizontally instead of overflowing.

### Scoped hardening pass (2026-06-23)
- Hardened core write endpoints:
  - `POST /api/qa`: now rejects whitespace-only questions, trims input before
    prompt/FTS usage, caps FTS term count/term length, and returns a generic
    failure message instead of surfacing raw internal error strings.
  - `POST /api/corrections`: now validates positive-integer `sourceId`/`deckId`
    when supplied (instead of silently ignoring malformed values), adds bounds
    for `value`/`surface`/`context`/`note`, and normalizes string inputs.
  - `POST /api/import/{apkg,textbook}`: filename guard (length/null-byte) and
    deck-name sanitization now strip control characters and enforce a safe
    fallback.
- Centralized defensive JSON parsing via new `server/src/utils/json.ts` and
  wired it into `routes/study.ts` and `routes/notes.ts` so malformed persisted
  JSON remains a row-level skip/fallback instead of request-wide failure.
- Added payload-size guard for JSON request bodies:
  `express.json({ limit: "1mb" })`.
- Client hardening:
  - API envelope parsing now validates shape more defensively.
  - Added malformed-import-result handling for textbook jobs.
  - Added duplicate-submit guards and `unknown`-safe error handling in key
    action paths (`Import`, `AddCard`, `Study`, `Decks`).
- Regression coverage updates:
  - `qa.route.test.ts`: whitespace-only question rejection.
  - `corrections.route.test.ts`: rejects invalid numeric ids and oversized value.
  - `imports.route.test.ts`: deck-name control-char sanitization behavior.

### Parallel build-refinement swarm, round 2 (2026-06-23)
Same pattern as round 1, run again on the now-merged result: 3 agents in
isolated worktrees, non-overlapping scopes (`server/src`, `client/src`,
`server/test`), no commits made by the agents — I applied diffs, resolved
one incidental overlap, re-ran the full gate suite, and committed.
- **Server-side:** fixed a real "never silently teach wrong Japanese"
  violation — `lib/jp/pitch.ts` fell back to `candidates[0]`'s pitch
  pattern when a supplied reading matched none of a homograph's known
  readings, silently returning the *wrong* word's pitch accent instead of
  `null`. Now only falls back when no reading was supplied at all; a
  genuine mismatch returns `null`. Also: wrapped `POST /api/notes`'s
  deck/note/card writes in a transaction (previously the only handler with
  no try/catch and no atomicity across its 3 sequential inserts), and
  added a `MAX_QUESTION_LENGTH` cap to `routes/qa.ts` (every other
  free-text field already had one; this one fed straight into FTS5 and the
  Anthropic prompt with no limit).
- **Client-side:** fixed a stale-closure bug where any scramble-chip "undo"
  click removed the *last*-placed word regardless of which chip was
  clicked; added cancellation guards to `Study.tsx`/`Decks.tsx`'s data-
  loading effects (rapid deck switching could let a stale response
  overwrite a newer one); fixed overlapping `Audio` instances on rapid
  listening-card replay clicks; moved focus to the first rating button on
  card flip (previously stranded on the now-hidden "Show answer" button);
  added missing `aria-label`s to several placeholder-only inputs; removed
  dead CSS rules with no corresponding markup.
- **Test coverage:** +57 tests (128→185, 16→21 files) covering
  `lib/segment.ts`, `lib/lang.ts`, `lib/shuffle.ts`, `routes/imports.ts`,
  `routes/qa.ts`, and expanded `backup.test.ts`. One accompanying source
  fix, reviewed before merging: `lib/segment.ts`'s section-keyword regexes
  all ended in `\b`, which is ASCII-only in JS and never matches adjacent
  to CJK characters — so Japanese-language section headers (会話/単語/文法
  etc., as opposed to bracketed-English headers) were silently
  misclassified as generic "content" instead of their real section type.
  Fixed with a Unicode-aware `(?![\p{L}\p{N}])` lookahead.
- **Incidental overlap:** the server and test-coverage agents both
  independently wrote `server/test/qa.route.test.ts` covering different
  (non-redundant) validation cases — merged by hand into one file keeping
  every distinct case from both (8 total).

### Parallel build-refinement swarm (2026-06-23)
Three agents ran in isolated git worktrees against non-overlapping scopes
(`server/src/**`, `client/src/**`, `server/test/**`), each tasked with
refining the existing build rather than adding features. All three came
back clean and were merged in directly (no commits made by the agents
themselves; I applied their diffs, re-ran the full gate suite, and
committed the result):
- **Server-side (`server/src/**`):** added missing `cardId`/`sourceId`
  validation to `routes/qa.ts`; standardized 4 responses in
  `routes/backup.ts` onto the `{ data, error }` envelope; indentation-only
  cleanups in `decks.ts`/`study.ts`/`notes.ts`; removed a dead `morae`
  variable in `lib/jp/tokenizer.ts`; fixed `lib/jp/colloquial.ts` to report
  the actual matched substring (`before.match(rule.re)?.[0]`) instead of
  the whole input text in its `from` field.
- **Client-side (`client/src/**`):** brought `AddCard.tsx` up to the same
  `pageVariants`/toast pattern already used on Decks/Import/Study; made
  the scramble-chip controls keyboard-accessible (`role="button"`,
  `tabIndex`, `onKeyDown`, `aria-label`); added `aria-expanded` to the
  analysis-toggle disclosure; added a `submitting`/`ratingDisabled`
  busy-state so rating buttons can't double-fire during an in-flight
  review POST; added a mobile breakpoint to `CardTypes.css` (previously had
  none despite Study.tsx being the most interaction-dense page); minor
  dead-CSS and inline-style cleanup in `index.css`/`Decks.tsx`.
- **Test coverage (`server/test/**`):** added `fsrs.test.ts`,
  `study.route.test.ts`, `corrections.route.test.ts`,
  `decks.sources.route.test.ts`, and expanded `corrections.test.ts` /
  `notes.manual.test.ts` — net +58 tests (70 → 128, 12 → 16 files).
  **One source change accompanied the tests, reviewed before merging:**
  `lib/fsrs.ts`'s `rowToFsrsCard` previously only clamped the FSRS
  scheduler's *output* (via the existing `bound()`) against NaN/Infinity;
  a corrupted prior row (bad migration, direct DB edit) could still reach
  the scheduler raw and produce an unpersistable `due`
  (`RangeError: Invalid time value`), crashing the review instead of
  degrading gracefully. Added a `boundInput()` helper applied to the prior
  row's `stability`/`difficulty`/`elapsed_days`/`scheduled_days`/`due`
  before they reach `ts-fsrs`, mirroring the existing output-clamping
  pattern. Covered by new regression tests in `fsrs.test.ts`.

All three diffs applied without conflicts (scopes were genuinely disjoint).
Full gate suite (`server/`: typecheck, test, build; `client/`: build)
re-run after merge and confirmed green.

### Reconciliation note (2026-06-23, ANTILOG → mine, round 4)
`ANTILOG` had moved 2 more commits (`7de1363` "Apple-Level Polish", `70f8162`
"Enterprise Hardening") past the round-3 sync point — caught by the
pre-push safety check before any sync, as designed. Merged via
`git merge --no-ff origin/ANTILOG`, resolved by hand:
- **Breaking API contract change, integrated:** nearly every JSON route now
  responds with a uniform `{ data, error }` envelope instead of a bare
  payload (`decks.ts`, `study.ts`, `imports.ts`, `notes.ts`, `corrections.ts`,
  `sources.ts`, `qa.ts`). Updated `client/src/lib/api.ts` to unwrap `.data`
  (new `unwrap<T>()` helper) in every fetch function that talks to those
  routes; `GET /api/backup` is unaffected (file download, not JSON). Applied
  the same envelope to `POST /api/notes`, which ANTILOG hadn't touched yet,
  for consistency.
- **New UI dependencies, integrated:** `framer-motion` (flip-card 3D reveal
  via `rotateY` + `backface-visibility: hidden`, page-transition variants)
  and `sonner` (toast notifications, replacing inline status `<p>` tags and
  `confirm()` dialogs on the Decks/Import pages). Installed both as real
  `client/package.json` dependencies.
- **StudyCard.tsx collision:** ANTILOG converted every card type to the
  flip-card structure (front/back simultaneously in the DOM, animated via
  `motion.div`). Kept that structure but layered my `deckId`-aware
  `AnalysisPanel`/`CorrectionForm` (inline correction submission, scoped by
  reading/grammar kind) onto every card's back face, and kept the
  `VocabCard`/`PitchCard` card types and furigana/pitch-diagram rendering
  entirely — ANTILOG's version doesn't have these card types at all.
- **Import.tsx collision:** kept my async-job-polling `importTextbook(file,
  name, onProgress)` call (the real, current 3-arg contract returning
  `{decks, totalCards}`) and the wider supported-media-type list; layered
  ANTILOG's `toast`-based progress/result UX on top instead of the removed
  `setStatus` state.
- **corrections.ts (lib) collision:** kept my synchronous `addCorrection`
  (the route's hybrid re-gating orchestration depends on it being sync) and
  merged in ANTILOG's input validation (`VALID_KINDS`/`VALID_SCOPES`) and
  null-byte sanitization on every string field.
- **Invariant-strengthening fix, kept:** `cardgen.ts`'s `pickJpClozeIndex`
  now excludes any token whose reading `needsReview` from cloze-candidate
  selection — an ambiguous-reading word can no longer become a cloze
  blank's answer, even when it's the sentence's most "interesting" content
  word. Updated the pre-existing `cardgen.gating.test.ts` case that asserted
  the old (less safe) behavior.
- **Also kept as-is:** `normalizeText()` pipeline step in `tokenizer.ts`
  (strips zero-width chars, full/half-width normalization, NFC) ahead of
  morphological analysis; `en.ts`'s cloze blanking rewritten to use
  `wink-nlp`'s exact token span instead of regex word-boundary counting;
  FSRS numeric clamping (`bound()` in `fsrs.ts`) against NaN/Infinity before
  persisting, plus a fix for `result.log.elapsed_days` being passed twice
  instead of once with `last_elapsed_days`; `db.pragma("synchronous =
  NORMAL")` / `busy_timeout = 5000`; `qa.ts`'s `AbortController` wired to
  client disconnect + 15s timeout; Multer upload limits (`files`/`fields`/
  `fieldSize`) with distinct 413/400 handling; `lang.ts`'s sentence
  splitting now treats `、` and any `\n` as terminators.
- **Fixed during merge:** `notes.manual.test.ts` asserted the old bare
  response shape (`body.noteId`) — updated to `body.data.noteId` for the new
  envelope.

### Reconciliation note (2026-06-23, ANTILOG → mine, round 3)
`ANTILOG` had been force-pushed with 5 new commits (Phase B+ re-gating,
Phase D media ingestion, Phase E/F Q&A + Anki field inference, a "Swarm"
hardening pass, and a docs update) since the last sync. Merged via
`git merge --no-ff origin/ANTILOG`, resolved by hand:
- **Phase B+ collision** (my `reGateExistingAnalyses` vs. their
  `syncNoteCards`): kept both, composed as a hybrid. `reGateExistingAnalyses`
  still does the in-place patch (provenance-preserving, scope-aware,
  defensive against corrupted rows) and now also returns the set of affected
  note IDs. Their re-synthesis idea was rewritten as `createNewlyEnabledCards`
  (`cardgen.ts`) — additive only: re-derives a note's card set and inserts
  card types that didn't exist before (e.g. a pitch card gated out by a
  previously-uncertain reading), but never deletes analyses or rewrites
  existing cards. `POST /api/corrections` now runs the patch, then the
  additive step over every affected note — closing the "can't retroactively
  create a card" gap noted in the original Phase B+ entry below.
- **Kept as-is:** `asyncHandler` Express wrapper + global error handling
  (Swarm pass), `ErrorBoundary` client crash boundary, the FTS5 `notes_fts`
  virtual table + triggers and startup backfill, the media-extraction
  pipeline (PDF/OCR/ASR/EPUB/SRT/VTT) with lazy-imported optional OCR/ASR
  deps, Anki field-role inference in `apkgImporter.ts`.
- **Fixed during merge:** `qa.ts`'s static `import Anthropic from
  "@anthropic-ai/sdk"` (with `// @ts-ignore`) wasn't in `package.json` and
  would have broken `tsc`/server boot — installed it as a real dependency
  (matches the locked decision: Q&A LLM = Claude API) and removed the
  ts-ignore. Added ambient `.d.ts` declarations for `tesseract.js` and
  `whisper-node` (optional, not in `package.json`) so `tsc` resolves the
  lazy `import()` calls in `jobs.ts` without requiring the packages at
  typecheck time. Fixed two tests that broke post-merge: the zip-bomb test
  fixture was missing a `col` table (every real `.apkg` has one; the new
  field-inference code in `apkgImporter.ts` queries it), and a corrections
  test tried to mutate a readonly ESM named export directly instead of
  `vi.spyOn(...).mockImplementation(...)`.
- **Safety tag** `pre-reconcile-1bf4f7d` left on the prior tip as a rollback
  point.

### Parallel hardening/debug/UI pass (2026-06-22)
Ran three agents in parallel (isolated git worktrees, no shared files) on
"harden the core engines, debug, and improve UI"; merged all three cleanly
and re-ran the full gate suite afterward.

**Server hardening** (`server/src/lib/corrections.ts`, `routes/{study,notes,
backup}.ts`, `lib/apkgImporter.ts`): several `JSON.parse()` calls on
DB-stored payloads (`note_analyses.alternatives`, `cards.question/answer`,
study-queue rows, note-analysis listing) had no error handling — one
corrupted row could throw and take down an entire request (the whole study
queue, or a whole `POST /api/corrections` batch). Now a bad row is skipped
and logged, not fatal to the rest of the batch — correction counts reflect
only rows actually updated. Also: `apkgImporter.ts`'s media-file write now
fails the import cleanly instead of leaving a half-imported state, and
`backup.ts`'s temp-file path is explicitly confined under the resolved tmp
dir. New tests cover the corrections-with-one-corrupted-row case.

**Real bug found and fixed (invariant-relevant):** uncertain readings were
being rendered as if confirmed, in three compounding layers — server-side
`furiganaOf()` (`cardgen.ts`) dropped both the reading *and* the uncertainty
flag for ambiguous kanji (e.g. 開く, 上手, 辛い) instead of calling the
already-correct logic that existed in `tokenizer.ts` but was dead code;
client-side `Furigana` had no render branch for "reading withheld entirely"
and silently fell through to a plain span; and `ListeningCard` never
rendered furigana on revealed answers at all, confident or not. All three
fixed; the `?` uncertainty marker now reliably reaches the screen. New
regression test in `cardgen.gating.test.ts`.

**Other bug fixed:** textbook import is async (`202 {jobId}` + background
job), but the client read result fields straight off that initial response
instead of polling `/api/import/jobs/:id` — always showed "Created undefined
cards from undefined sentences." Now polls until the job completes.

**UI polish:** Japanese cloze cards never revealed their answer in place
(blank-matching regex only handled the ASCII English blank, not the
full-width JP one) — looked permanently broken. Also fixed: mobile header
wrapping/overlap at narrow widths, an entirely unstyled `<select>` on the
add-card deck picker, an inconsistent bare-text loading state on the study
page (now uses the same skeleton loader as Decks), and "1 cards" singular/
plural text.

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
| Corrections + re-gating | `src/lib/corrections.ts`, `src/lib/cardgen.ts` (`createNewlyEnabledCards`), `src/routes/corrections.ts` |
| Media ingestion (OCR/ASR/EPUB/subtitles) | `src/lib/jobs.ts` (`extractMediaText`) |
| Q&A (Claude API, FTS5-backed retrieval) | `src/routes/qa.ts` |
| Error handling | `src/utils/asyncHandler.ts` |
| HTTP routes | `src/routes/{decks,imports,study,sources,notes,corrections,backup,qa}.ts` |

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
`sources` (provenance), `note_analyses` (per-note reading/grammar provenance),
`notes_fts` (FTS5 virtual table over `notes`, BM25-ranked, backs `qa.ts`).
Older DBs are migrated in place via `ensureColumn` in `src/db/index.ts`.

### HTTP API
- `GET/DELETE /api/decks`
- `POST /api/import/apkg`, `POST /api/import/textbook` (→ jobId), `GET /api/import/jobs/:id`
- `GET /api/study/queue`, `POST /api/study/cards/:id/review`
- `POST /api/corrections`
- `GET /api/sources`, `GET /api/sources/:id`
- `GET /api/notes/:id/analysis`
- `POST /api/notes` (manual add-card)
- `GET /api/backup` (SQLite DB download)
- `POST /api/qa` (streaming Claude-API answer, grounded in FTS5 retrieval + optional card/source context)
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
| B+ | Corrections ↔ analysis loop (mark `corrected_by_user`, re-gate affected cards, additively create newly-enabled cards) | ✅ Done (global/matching/deck/source scope; occurrence/sentence intentionally forward-only, see hardening note) |
| D | Ingestion breadth: OCR (Claude Haiku vision), ASR (gpt-4o-mini-transcribe), EPUB, subtitles | ✅ Done |
| E | Source-grounded Q&A (Claude API) + search/retrieval indexes (FTS5) | ✅ Done |
| F | Client UI: surface confidence/evidence/grammar, correction & review UI | ✅ Done |
| — | Anki field-role inference (japanese/reading/meaning/audio/…) with confidence | ✅ Done |

**Decisions locked in:** OCR/ASR = cloud API (Claude Haiku vision for OCR,
gpt-4o-mini-transcribe for ASR) — updated 2026-06-23, supersedes earlier
"local OSS" decision; Q&A LLM = Claude API; personal-use only (no
multi-tenant/marketplace/sharing); no preloaded curriculum; do not rewrite
from scratch.

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
