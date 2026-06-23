# Working agreement for Claude

This repo is edited by **two** agents, on **separate branches**:
- **Claude** (me) — works on `claude/science-learning-app-fsrs-xnkrwu`, commits
  authored as `Claude <noreply@anthropic.com>`. This is the **primary
  branch** — the user treats my work as the source of truth.
- **Antigravity** — a local "speed building" tool the user runs against its
  own branch **`ANTILOG`**, but never concurrently with my work. Because of
  that, `ANTILOG` should always mirror my latest: **after every change I
  push to my branch with green quality gates, I also push that same commit
  to `ANTILOG`** — the user has explicitly authorized overwriting it, since
  they never run both tools at once.

  **Safety check before every `ANTILOG` push:** confirm
  `git merge-base --is-ancestor origin/ANTILOG <my-branch>` succeeds (i.e.
  `ANTILOG`'s current tip is already contained in my history) before
  pushing. If it fails, that means unreconciled Antigravity work exists that
  I haven't seen yet — stop and run the reconciliation protocol below
  instead of overwriting it.

The git remote is the only shared channel. I run in an ephemeral clone, so I
only see Antigravity's work **after it is committed and pushed** to its
branch. The user decides when to bring that work in (e.g. after a local
Antigravity session); I decide what to keep once asked to reconcile — and
once reconciled, the merged result becomes both branches again via the sync
step above.

## Reconciliation protocol (run when asked to bring in Antigravity's work,
## or at the start of a session if its branch has moved since I last checked)

1. **Detect.**
   - `git fetch origin` (all branches, or at least mine + `ANTILOG`).
   - Find where `ANTILOG` diverges from my branch: `git merge-base
     origin/ANTILOG origin/<my-branch>` gives the anchor directly — no
     separate doc note to maintain, since both branches converge after every
     sync (see the safety check above).
   - Read the diff/log on `ANTILOG` since that anchor — this is the full set
     of external changes to evaluate, not just the latest commit.

2. **Decide what to keep.** Default to **integrating** external changes and
   preserving their intent. Only override or drop a change when it:
   - breaks the core invariant — *never silently teach wrong Japanese*
     (confidence/evidence/gating must remain intact), or
   - violates a locked decision (personal-use only; OCR via Claude API vision,
     ASR via a cloud transcription API (e.g. OpenAI Whisper API) — both
     superseding the original "local OSS for OCR/ASR" decision as of 2026-06;
     Claude API for Q&A; no preloaded curriculum; no rewrite-from-scratch), or
   - breaks `npm run typecheck`, `npm test`, or `npm run build`.
   When I override or drop something, I say so explicitly to the user.

3. **Merge strategy.** Merge (or cherry-pick) `ANTILOG` into mine — the
   reconciliation direction is always ANTILOG → mine. If my branch has
   diverged since the last sync, rebase my unmerged work on top of the merge
   result so history stays linear. Resolve conflicts in favor of Antigravity's
   newer intent unless it breaks an invariant above.

4. **Verify + record.** After reconciling: run typecheck + tests + build,
   add a dated note to `PROJECT_STATUS.md` of what was kept/dropped, commit,
   and push to my branch.

5. **Sync `ANTILOG` back to match.** Push the same commit onto `ANTILOG` so
   it mirrors my branch again (see the sync rule above) — this is what
   "reconciling" produces: one converged state on both branches.

6. **Report.** Give the user a brief summary: what external changes I
   detected and my keep/drop decisions.

## Quality gates (must stay green before any push)
From `server/`: `npm run typecheck`, `npm test`, `npm run build`. This applies
to every push, including the `ANTILOG` sync — never sync a change onto
`ANTILOG` that hasn't passed the gates on my branch first.

## Pointers
- `PROJECT_STATUS.md` — living status, updated on every change. The
  reconciliation anchor is no longer tracked here in writing — it's derived
  from git (`git merge-base`) since the two branches converge after every
  sync, so there's nothing to keep manually in sync.
