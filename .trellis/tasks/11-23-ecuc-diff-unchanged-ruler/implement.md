# Implementation plan — unchanged regions and semantic navigation

## Branch gate

- [ ] Wait for PR #40 to merge to `main`.
- [ ] `git switch main && git pull`.
- [ ] Create `feat/ecuc-diff-unchanged-ruler` from latest `main`.
- [ ] `task.py start 11-23-ecuc-diff-unchanged-ruler` from that branch.
- [ ] Do not start from `feat/ecuc-vscode-parity`.

## Phase 0 — Baseline

- [ ] Capture Show all, Show diff + Context on/off and a one-sided placeholder state.
- [ ] Confirm the native `hideUnchangedRegions` options and widget DOM; record reference geometry.
- [ ] Record the current `getLineChanges()` navigation mismatches for renames/placeholders.

## Phase 1 — Native unchanged widgets

- [ ] Keep `hideUnchangedRegions` and the Show all/Show diff/Context toolbar path.
- [ ] Verify context rows, widget geometry/labels/chevrons and expanded/collapsed behavior against
      the reference.
- [ ] Add scoped CSS only if the native widget needs alignment.
- [ ] Ensure `diff-one-sided` placeholders are not hidden/expanded as real context.
- [ ] Add the preview state for Show diff + Context and Show all.

## Phase 2 — Semantic ruler

- [ ] Add semantic `overviewRuler` decorations for changed/added/removed on both panes.
- [ ] Use the existing line maps; skip missing-side placeholders.
- [ ] Add current/selected emphasis without losing the semantic mark.
- [ ] Do not use `getLineChanges()` for marks.

## Phase 3 — Semantic navigation

- [ ] Build `semanticChanges()` from `documentModel.rows` and the line maps.
- [ ] Replace `navigate()`'s `getLineChanges()` source; keep the ARXML toolbar Prev/Next controls.
- [ ] Handle swap, renames/semantic pairs, ends/wrap and placeholder skipping.
- [ ] Keep search/find and no VS Code toolbar controls.

## Phase 4 — Tests/preview

- [ ] Unit tests for change ordering, swap target, ends and placeholder skipping.
- [ ] Preview/audit for the native widget, ruler marks and navigation.
- [ ] Keep `diff-one-sided`, merge, search, collapse and existing audits green.

## Phase 5 — Verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] Focused tests
- [ ] `npm test --ignore-scripts`
- [ ] `npm run shots:webview`
- [ ] `node esbuild.js --production`
- [ ] `git diff --check`
- [ ] Dark+/Light+ reference checks; HC smoke.

## Review gates

- [ ] Native unchanged widgets match VS Code geometry/behavior; Show all/Show diff/Context work.
- [ ] Placeholders are not treated as real hidden context.
- [ ] Ruler marks follow semantic status on both panes.
- [ ] Prev/Next follows semantic rows, not Monaco line changes; swap/ends correct.
- [ ] Current ARXML toolbar and semantic diff behavior remain.
- [ ] Full suite/preview/production pass.

## Rollback

- [ ] Revert the ruler/navigation and native-widget CSS; the semantic diff and toolbar remain.
