# Working agreement for Claude

This repo is edited by **two** agents:
- **Claude** (me) — commits authored as `Claude <noreply@anthropic.com>`.
- **Antigravity** — the user runs it separately against their local copy.

The git remote is the only shared channel. I run in an ephemeral clone, so I
only see Antigravity's work **after it is committed and pushed**. The user has
asked me to decide what to keep when I detect changes I did not make.

## Reconciliation protocol (run at the start of every working session)

1. **Detect.** Before making changes:
   - `git fetch origin <branch>`
   - Compare `HEAD` / `origin/<branch>` against the **Last synced commit**
     recorded in `PROJECT_STATUS.md`.
   - Any commit on the branch **not** authored by `Claude <noreply@anthropic.com>`,
     and any uncommitted working-tree change, is an external (Antigravity/user)
     change.

2. **Decide what to keep.** Default to **integrating** external changes and
   preserving their intent. Only override or drop a change when it:
   - breaks the core invariant — *never silently teach wrong Japanese*
     (confidence/evidence/gating must remain intact), or
   - violates a locked decision (personal-use only; local OSS for OCR/ASR;
     Claude API for Q&A; no preloaded curriculum; no rewrite-from-scratch), or
   - breaks `npm run typecheck`, `npm test`, or `npm run build`.
   When I override or drop something, I say so explicitly to the user.

3. **Merge strategy on divergence.** If both sides committed, rebase my pending
   work on top of theirs (favor their newer intent on conflicts unless it
   breaks an invariant above). Never force-push over external commits without
   first preserving them.

4. **Verify + record.** After reconciling: run typecheck + tests + build,
   update `PROJECT_STATUS.md` (Last synced commit, date, and a short note of
   what external changes were kept/dropped), commit, and push.

5. **Report.** Give the user a brief summary: what external changes I detected
   and my keep/drop decisions.

## Quality gates (must stay green before any push)
From `server/`: `npm run typecheck`, `npm test`, `npm run build`.

## Pointers
- `PROJECT_STATUS.md` — living status; its "Last synced commit" line is the
  reconciliation anchor and must be updated on every change.
