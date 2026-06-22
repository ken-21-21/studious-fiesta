# Working agreement for Claude

This repo is edited by **two** agents, on **separate branches**:
- **Claude** (me) — works on `claude/science-learning-app-fsrs-xnkrwu`, commits
  authored as `Claude <noreply@anthropic.com>`.
- **Antigravity** — the user runs it separately against their local copy, on
  its own branch (e.g. `antigravity/*` — confirm the exact name with the user
  if unclear). Never push to Antigravity's branch myself.

The git remote is the only shared channel. I run in an ephemeral clone, so I
only see Antigravity's work **after it is committed and pushed** to its
branch. The user decides when to bring that work in; I decide what to keep
once asked to reconcile.

## Reconciliation protocol (run when asked to bring in Antigravity's work,
## or at the start of a session if its branch has moved since I last checked)

1. **Detect.**
   - `git fetch origin` (all branches, or at least mine + Antigravity's).
   - Compare Antigravity's branch tip against the **Last synced commit**
     recorded in `PROJECT_STATUS.md` for that branch.
   - Read the diff/log on Antigravity's branch since that anchor — this is
     the full set of external changes to evaluate, not just the latest commit.

2. **Decide what to keep.** Default to **integrating** external changes and
   preserving their intent. Only override or drop a change when it:
   - breaks the core invariant — *never silently teach wrong Japanese*
     (confidence/evidence/gating must remain intact), or
   - violates a locked decision (personal-use only; local OSS for OCR/ASR;
     Claude API for Q&A; no preloaded curriculum; no rewrite-from-scratch), or
   - breaks `npm run typecheck`, `npm test`, or `npm run build`.
   When I override or drop something, I say so explicitly to the user.

3. **Merge strategy.** Merge (or cherry-pick) Antigravity's branch into mine —
   never the reverse, and never force-push over Antigravity's branch. If my
   branch has diverged since the last sync, rebase my unmerged work on top of
   the merge result so history stays linear. Resolve conflicts in favor of
   Antigravity's newer intent unless it breaks an invariant above.

4. **Verify + record.** After reconciling: run typecheck + tests + build,
   update `PROJECT_STATUS.md` (Last synced commit for Antigravity's branch,
   date, and a short note of what was kept/dropped), commit, and push to my
   branch.

5. **Report.** Give the user a brief summary: what external changes I
   detected and my keep/drop decisions.

## Quality gates (must stay green before any push)
From `server/`: `npm run typecheck`, `npm test`, `npm run build`.

## Pointers
- `PROJECT_STATUS.md` — living status; its "Last synced commit" lines are the
  reconciliation anchors (one per agent/branch) and must be updated on every
  change.
