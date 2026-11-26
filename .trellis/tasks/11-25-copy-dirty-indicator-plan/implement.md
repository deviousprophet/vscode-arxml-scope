# Implementation plan — merge-copy responsiveness and unsaved-copy indication

> Started on `feat/copy-dirty-indicator-and-preview-stack` (renamed from `docs/plan-next-pr`).

- [x] Create the next branch from `main` after PR #42 merges.
- [x] Instrument the current copy path and capture 1/10/100-row timings.
- [x] Decide the targeted patch protocol from measured hot spots.
- [x] Add host copied-row/dirty state and targeted copy acknowledgement.
- [x] Add editor dirty-line decorations and clear-on-save/undo behavior.
- [x] Add diff dirty-side/row decorations.
- [x] Add refusal/stale-copy rollback and scroll/fold preservation.
- [x] Add preview states and host tests for dirty, save, refusal and undo.
- [x] Run full gates and compare the benchmark.
- [x] Document the user-visible dirty semantics.

## What landed

- `src/core/copy/copyDirty.ts` — pure store: target-side keys, added-row
  normalization, offset shift, undo/edit-over drop, save clear, close forget.
- `src/core/diff/minimalEdit.ts` — the line-level splice the page applies to a
  `documentPatch`, so a copy never calls `setValue` on both models.
- `src/host/copyDirty.ts` — the extension's one registry, bound to document
  change/save/close events; `src/host/copyTiming.ts` — the per-copy phase clock
  (`ARXML_COPY_TIMING=1` logs it).
- `DiffPanel` records the copied rows after the engine patch and posts
  `copyDirty` + `copyResult`; `EcucEditorProvider` posts `copyDirty` for the same
  document.
- Diff page: `arxml-copied-line` margin markers on the copied side,
  `arxml-copy-pending` while one copy is in flight, and a line-level
  `documentPatch` with both view states restored.
- Editor page: `arxml-copied-line` margin bar plus `arxml-copied-line-bg` tint
  for the registry's row ids.
- Preview states `diff-copied` and `editor-copied` with an audit rule that the
  margin marker must paint.

## Benchmark (`npm run benchmark copy`)

Recorded on the 400-parameter fixture; `refreshMs` is the old full re-scan +
`buildDiffDocument` path a copy used to trigger, `pageRebuildMs` is the patch the
page now applies.

| rows | planMs | applyMs | refreshMs | pageRebuildMs |
|---|---|---|---|---|
| 1 | 1 | 0 | 13 | 0 |
| 10 | 1 | 0 | 10 | 0 |
| 100 | 2 | 0 | 13 | 0 |

## Validation

- `npm run check-types`, `npm run lint` clean.
- `npm test` — full suite green (see the commit batch).
- `npm run benchmark copy` — plan and page-patch budgets hold.
- `webview-preview` — `diff-copied`, `editor-copied` captured with no violations.
- `npm run engine:smoke`, `npm run rust:test` unchanged by this branch.

## Rollback

The copy path and dirty protocol are additive; remove the new messages and
decorations if the branch is abandoned.
