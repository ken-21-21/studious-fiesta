# Working agreement for Claude

This repo is edited by **two** agents, on **separate branches**:
- **Claude** (me) — works on `claude/science-learning-app-fsrs-xnkrwu`, commits
  authored as `Claude <noreply@anthropic.com>`. This is the **primary
  branch** — the user treats my work as the source of truth.
- **Antigravity** — a local "speed building" tool the user runs against its
  own branch **`ANTILOG`**, but never concurrently with my work. Because of
  that, `ANTILOG` should always mirror my latest: **after every change I
  push to my branch with green quality gates, I also push that same commit
  to `ANTILOG`** (fast-forward if possible, otherwise overwrite — the user
  has explicitly authorized this since they never run both at once, so
  there's nothing on `ANTILOG` to lose by overwriting it).

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
   - Compare `origin/ANTILOG`'s tip against the **Last synced commit**
     recorded in `PROJECT_STATUS.md` for that branch.
   - Read the diff/log on `ANTILOG` since that anchor — this is the full set
     of external changes to evaluate, not just the latest commit.

2. **Decide what to keep.** Default to **integrating** external changes and
   preserving their intent. Only override or drop a change when it:
   - breaks the core invariant — *never silently teach wrong Japanese*
     (confidence/evidence/gating must remain intact), or
   - violates a locked decision (personal-use only; local OSS for OCR/ASR;
     Claude API for Q&A; no preloaded curriculum; no rewrite-from-scratch), or
   - breaks `npm run typecheck`, `npm test`, or `npm run build`.
   When I override or drop something, I say so explicitly to the user.

3. **Merge strategy.** Merge (or cherry-pick) `ANTILOG` into mine — the
   reconciliation direction is always ANTILOG → mine. If my branch has
   diverged since the last sync, rebase my unmerged work on top of the merge
   result so history stays linear. Resolve conflicts in favor of Antigravity's
   newer intent unless it breaks an invariant above.

4. **Verify + record.** After reconciling: run typecheck + tests + build,
   update `PROJECT_STATUS.md` (Last synced commit for `ANTILOG`, date, and a
   short note of what was kept/dropped), commit, and push to my branch.

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
- `PROJECT_STATUS.md` — living status; its "Last synced commit" lines are the
  reconciliation anchors (one per agent/branch) and must be updated on every
  change.
