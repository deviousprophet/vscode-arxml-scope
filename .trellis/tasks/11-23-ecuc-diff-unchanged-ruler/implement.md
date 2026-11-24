# Implementation plan — unchanged regions and semantic navigation

## Branch gate

- [x] PR #40 merged to `main`.
- [x] Body surface is complete on `feat/ecuc-diff-body-surface`.
- [x] Continue on `feat/ecuc-diff-body-surface`; the user chose to finish all remaining diff-body tasks on one branch.
- [ ] `task.py start 11-23-ecuc-diff-unchanged-ruler` on that branch.
- [ ] Do not create `feat/ecuc-diff-unchanged-ruler` or start from `feat/ecuc-vscode-parity`.

## Phase 0 — Baseline

- [ ] Capture Show all, Show diff + Context on/off and a one-sided placeholder state.
- [ ] Confirm the native `hideUnchangedRegions` options and widget DOM; record reference geometry.
- [ ] Record the current `getLineChanges()` navigation mismatches for renames/placeholders.

## Phase 1 — Native unchanged widgets

- [x] Keep `hideUnchangedRegions` and the Show all/Show diff/Context toolbar path.
- [x] Verify context rows, widget geometry/labels/chevrons and expanded/collapsed behavior against
      the reference.
- [x] Add scoped CSS only if the native widget needs alignment.
- [x] Ensure `diff-one-sided` placeholders are not hidden/expanded as real context.
- [x] Add the preview state for Show diff + Context and Show all.

## Phase 2 — Overview ruler (superseded)

- [x] ~~Add semantic `overviewRuler` decorations for changed/added/removed on both panes.~~
- [x] ~~Use the existing line maps; skip missing-side placeholders.~~
- [x] ~~Add current/selected emphasis without losing the semantic mark.~~
- [x] ~~Do not use `getLineChanges()` for marks.~~

Superseded 2026-11-24: strict built-in parity keeps Monaco's native
`renderOverviewRuler` and removes all semantic ruler decorations.

## Phase 3 — Semantic navigation

- [x] Build `semanticChanges()` from `documentModel.rows` and the line maps.
- [x] Replace `navigate()`'s `getLineChanges()` source; keep the ARXML toolbar Prev/Next controls.
- [x] Handle swap, renames/semantic pairs, ends/wrap and placeholder skipping.
- [x] Keep search/find and no VS Code toolbar controls.

## Phase 4 — Tests/preview

- [x] Unit tests for change ordering, swap target, ends and placeholder skipping.
- [x] Preview/audit for the native widget, ruler marks and navigation.
- [ ] Keep `diff-one-sided`, merge, search, collapse and existing audits green.

## Phase 5 — Verification

- [x] `npm run check-types`
- [x] `npm run lint`
- [x] Focused tests
- [x] `npm test --ignore-scripts`
- [ ] `npm run shots:webview`
- [x] `node esbuild.js --production`
- [x] `git diff --check`
- [ ] Dark+/Light+ reference checks; HC smoke.

## Review gates

- [x] Native unchanged widgets match VS Code geometry/behavior; Show all/Show diff/Context work.
- [x] Placeholders are not treated as real hidden context.
- [x] Monaco's built-in `.diffOverview` stays on; no semantic ruler decorations remain.
- [x] Prev/Next follows semantic rows, not Monaco line changes; swap/ends correct.
- [x] Current ARXML toolbar and semantic diff behavior remain.
- [ ] Full suite/preview/production pass.

## Rollback

- [ ] Revert the ruler/navigation and native-widget CSS; the semantic diff and toolbar remain.

## Execution notes (2026-11-24)

- **Scope change:** the user confirmed strict built-in parity for the middle area.
  The semantic `overviewRuler` marks and selected-row emphasis were removed;
  `renderOverviewRuler` is now on and the native diff overview is the ruler.
  Semantic Prev/Next and the native unchanged widgets remain.
- Implemented the pure `semanticChanges`/`navigationTarget`/`stepChange`/
  `cursorChangeIndex` helpers (`webview/monaco/diffBody.ts`). Prev/Next steps
  semantic rows, prefers the last-focused pane, falls back to the owning pane for
  a one-sided row, and wraps.
- Kept Monaco's native `hideUnchangedRegions` untouched; the preview state
  `diff-unchanged` and its audit record the 24px center, `{n} hidden lines`,
  unfold control, handles, Show all clearing and Context off/on.
- Added the `diff-nav` state and fixture (removed parameter then a moved,
  renamed container) so the first line change and the first semantic row differ.
- The reopened `11-23-ecuc-diff-body-surface` rework landed alongside this task:
  the body now uses per-side unaligned documents and the built-in diff paint. The
  ruler/navigation/unchanged code was carried into that page; the preview audit
  grew the native-paint, line-count and center-margin checks. The old aligned
  placeholder contract in `diff-one-sided` is superseded by that rework.
- Gates that pass: `check-types`, `lint`, focused tests, full `npm test
  --ignore-scripts` (1008 passing), fallow GREEN, `node esbuild.js --production`,
  `git diff --check`.
- Blocked at capture time: `npm run shots:webview` cannot launch any headless
  Chromium in this session (Edge exits 0 with no DOM/screenshot even for
  `about:blank`). The preview audit therefore has not been observed; rerun it
  when the browser host recovers.
- The earlier pre-rework copies of the collided files remain under
  `artifacts/concurrent/` for reference; the working tree is the per-side version.
