# Implementation plan — PR 42 review fixes

## Phase 1 — Code cleanup

- [x] Replace the merge class with `data-merge`; update `monaco.css` and preview probes.
- [x] Move hunk mapping to `src/webview/monaco/diffBody.ts`; import it in `diffMonaco.ts`.
- [x] Remove `buildAlignedSyntheticDocuments` and its helpers/tests.
- [x] Add `lineNumbersMinChars: 3`, `lineDecorationsWidth: 14`; remove
      `renderMarginRevertIcon`.
- [x] De-duplicate `diffGutterAvailability` lookup; import mapping/range types; rename
      the readiness check; remove `selectedKey`; rename the preview snapshot global.

## Phase 2 — Preview proof

- [x] Fix `jumpToChange` to target `#diff-monaco`.
- [x] Remove legacy `.diff-pane`/`.diff-row`/arrow/placeholder scan code from
      `previewAudit.ts`.
- [x] Add per-item rendered labels to `GutterProbe`; assert one-sided/changed pairs from
      the rendered toolbar.
- [x] Add hover/current-hunk probe and overflow submenu probe.
- [x] Measure folding in both panes.
- [x] Add non-Merge and Swap sash states/probes.
- [x] Keep `paneSnapshot`/Swap proof aligned with the Monaco DOM or remove it.

## Phase 3 — Specs and tests

- [x] Update `css-guidelines.md`, `component-guidelines.md`, `testing.md`,
      `directory-structure.md`.
- [x] Rename `diffCodeParity.test.ts` to an explicit source-contract suite.
- [x] Update the archived task PRD/design for the accepted patch and `readOnly` Revert.
- [x] Re-run the full preview set and clean any vacuous audit output.

## Phase 4 — Changelog

- [x] Rewrite `[Unreleased]` as a net `v0.10.0..HEAD` list.
- [x] Fold/drop in-range Fixed bullets.
- [x] Run the header/section/style checks.

## Phase 5 — Gates

- [x] `npm run check-types`
- [x] `npm run lint`
- [x] `npm run compile-tests`; `npm test --ignore-scripts`
- [x] full preview skill set
- [x] fallow GREEN
- [x] `node esbuild.js --production`
- [x] `git diff --check`
- [x] commit, push, wait for CI

## Rollback

Revert the task commits; no protocol or persisted-data migration.

## Execution notes

- **2026-11-25 — review pass:** removed the legacy aligned builder and its tests, moved hunk mapping to `monaco/diffBody.ts`, replaced the `arxml-diff-merge` class with `data-merge`, removed `selectedKey`, de-duplicated gutter availability, and removed `renderMarginRevertIcon`.
- **Preview proof:** `diff-off` and `diff-swap` run the sash probe; `diff-one-sided` opens the overflow submenu; `diff-removed`/`diff-added` assert rendered per-item labels; folding measures both panes. Full seeded set passes 36/36.
- **Specs/changelog:** css/component/testing/directory/state/hook/component specs now describe the Monaco surface; `[Unreleased]` was rewritten as the net `v0.10.0..HEAD` outcome set.
- **Gates:** check-types, lint, 907 tests, fallow GREEN, 36/36 preview states, production bundle and `git diff --check` pass.
