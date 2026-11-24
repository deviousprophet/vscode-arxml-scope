# Implementation plan — built-in VS Code diff gutter and sash

## Branch gate

- [x] Start a fresh branch from `main`: `feat/ecuc-diff-vscode-gutter`.
- [x] Close and delete the abandoned `feat/ecuc-diff-body-surface` branch and PR #41.
- [x] Create the fresh `11-24-ecuc-diff-vscode-gutter` task.
- [ ] `task.py start 11-24-ecuc-diff-vscode-gutter` after reviewing these artifacts.
- [ ] Do not cherry-pick or depend on the abandoned branch.

## Phase 0 — Baseline

- [x] Freeze the `main` behavior: custom aligned placeholders, glyph merge arrows, `enableSplitViewResizing: false`, `renderMarginRevertIcon: false` and the custom merge CSS.
- [x] Record the exact Monaco `DiffEditorGutter`/`DiffToolBar`/`DiffEditorSash` paths and `monaco-editor@0.57.0` integrity.
- [x] Confirm the built-in `DiffEditorHunkToolbar` menu and `ActionRunnerWithContext` payload from the pinned source.
- [x] Confirm `readOnly: true` hides the built-in Revert action while the gutter and sash still mount for custom actions.
- [x] Add no reference images or screenshot baseline; the proof is code/DOM.

## Phase 1 — Per-side synthetic body

- [ ] Replace `buildAlignedSyntheticDocuments` on the page path with `buildDiffSyntheticDocuments`.
- [ ] Emit only the owning side’s module gaps, comments, cells and braces; no blank placeholders.
- [ ] Keep per-side line counts, `rowLine`, line-key arrays and folding ranges.
- [ ] Add `src/webview/monaco/diffBody.ts` with `DiffBody`, `buildDiffBody`, `lineOnSide`, `linesOnSide`, `SemanticChange` and navigation helpers.
- [ ] Remove placeholder decorations, masks, `arxml-diff-placeholder*` CSS and pre-aligned assumptions.
- [ ] Unit tests: per-side line counts, one-sided gaps, comments/braces, row/line maps.

## Phase 2 — Native diff body

- [ ] Enable native indicators, fills, word spans, diagonal gaps, overview ruler and unchanged widgets.
- [ ] Remove custom fills, signs, word spans, selection/subtree tint and semantic ruler decorations.
- [ ] Remove CSS that neutralizes native paint or restores custom placeholder/merge layers.
- [ ] Keep only the ARXML syntax/theme, inherited editor settings and body audit hooks.
- [ ] Verify one-sided gaps use native `.diagonal-fill` with no numbered placeholder.

## Phase 3 — Built-in gutter, toolbar and sash

- [x] Set `renderGutterMenu: true`, `enableSplitViewResizing: true`, 50/50 default, side-by-side.
- [x] Set `readOnly: true`; keep inner editors read-only; hide built-in Revert.
- [x] Add `src/webview/monaco/diffGutterActions.ts`:
  - [x] import pinned internal `MenuRegistry`, `MenuId.DiffEditorHunkToolbar`, `CommandsRegistry`, `Codicon`;
  - [x] register exactly two commands: Copy Block to Left / Copy Block to Right;
  - [x] append both menu items in group `primary`, no `diffEditorModifiedWritable` dependency;
  - [x] map the `ActionRunnerWithContext` payload to the topmost semantic row;
  - [x] post the existing host `copy` with the stored source side;
  - [x] never edit the synthetic models.
- [x] Keep the 35px gutter and sash mounted in all modes; hide only `.gutterItem` outside Merge.
- [ ] Verify the sash drag and double-click reset.
- [ ] Verify the ratio survives `setModel`/document updates and Swap; restore it with the smallest adapter if Monaco resets it.

## Phase 4 — Hover, availability and Merge gating

- [ ] Add `src/webview/monaco/diffGutterAvailability.ts` with `arxml.copyLeftAvailable` / `arxml.copyRightAvailable` context keys.
- [ ] Update availability for the current hunk on cursor changes (`showAlways`) and the hovered `.gutterItem` on gutter hover/leave.
- [ ] Hide the impossible direction on one-sided hunks; show both on changed pairs.
- [ ] Keep VS Code `showAlways` for the current hunk inside Merge; other hunks reveal on hover.
- [ ] Hide copy items outside `#diff-monaco.arxml-diff-merge`; keep the gutter/sash for resizing.
- [ ] Verify tooltips/icons/aria labels are exactly Copy Block to Left/Right.
- [ ] Verify no built-in Revert, no third button, no overlapping controls.

## Phase 5 — Full parity sweep

- [ ] Compare options and DOM against VS Code 1.125 for hover, focus, overview ruler, unchanged widgets, indicators/fills, scrollbars and accessibility names.
- [ ] Confirm the ARXML toolbar, Merge, Swap, search, collapse, Show all/diff and semantic Prev/Next remain.
- [ ] Remove all old custom merge/arrow/placeholder code paths and tests.
- [ ] Document every intentional deviation with a code-level reason; none should be visual guesses.

## Phase 6 — Code-parity proof

- [ ] Write `docs/vscode-diff-parity.md` with VS Code 1.125.0, Monaco 0.57.0, npm integrity, upstream paths and adapter files.
- [ ] Add `src/test/webview/diffCodeParity.test.ts`:
  - [ ] assert the pinned version/integrity;
  - [ ] hash `gutterFeature.js`, `diffEditorSash.js`, `diffEditorWidget.js`, `diffEditor.contribution.js`;
  - [ ] assert the built-in options/imports/action registrations;
  - [ ] assert no custom margin/arrow/placeholder/selection/ruler classes or CSS.
- [ ] Update `docs/WEBVIEW_PREVIEW.md` and `DESIGN.md` for the new contract.

## Phase 7 — Preview/audit

- [ ] Add/update `diff-body`, `diff-one-sided`, `diff-removed`, `diff-unchanged`, `diff-nav` and a sash state.
- [ ] Audit the real DOM: `.gutter`, `.gutterItem`, `.sash`, labels/icons, hover/current-hunk, Merge gating.
- [ ] Hover-probe a changed hunk, a left-only hunk and a right-only hunk; assert the visible actions.
- [ ] Click both copy actions and assert the host `copy` side/key under Swap.
- [ ] Drag the sash and double-click it; assert pane width changes and 50/50 reset.
- [ ] Assert the ratio survives a document update and Swap.
- [ ] Assert native paint, overview ruler and unchanged widgets remain.
- [ ] Fail the capture if the gutter/model/DOM is missing; no screenshot-only pass.

## Phase 8 — Verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] Focused body/gutter/parity tests
- [ ] `npm test --ignore-scripts`
- [ ] `npm run shots:webview`
- [ ] `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs` -> GREEN
- [ ] `node esbuild.js --production`
- [ ] `git diff --check`

## Review gates

- [ ] The diff view uses the built-in VS Code gutter, toolbar and sash; no custom rebuild remains.
- [ ] Per-side body has no blank placeholders and uses native paint.
- [ ] Hover/Merge/tooltips/one-sided availability match the confirmed behavior.
- [ ] Copy targets the topmost row and preserves displayed-pane semantics under Swap.
- [ ] Sash resizing works in every mode with VS Code ratio behavior.
- [ ] The ARXML toolbar and semantic behavior remain.
- [ ] Code-parity manifest/hashes/source/runtime tests pass.
- [ ] Full suite/preview/fallow/production pass.

## Rollback

- [ ] Revert the task commits on the isolated branch; no protocol, persisted format or host data migration.

## Execution notes

- **2026-11-24 — gutter spike:** the built-in `renderGutterMenu` mounts a 35px `.gutter` with four `.gutterItem`s for the merge pair, two action buttons per item, the correct `Copy Block to Left`/`Right` labels, and a `.monaco-sash.vertical`. `readOnly: true` hides the built-in Revert action. Outside Merge, `.gutterItem` is `display:none` while the gutter and sash remain. Clicking a copy button posted the correct host `copy` for `P0002`.
- `monaco-editor@0.57.0` already contains the exact VS Code 1.125 `DiffEditorGutter`, `DiffToolBar` and `DiffEditorSash`; the adapter imports only `MenuRegistry`/`MenuId`/`CommandsRegistry`/`Codicon`.
- Per-side `buildDiffSyntheticDocuments` is now on the page path; `diff-one-sided` renders without blank placeholders. The legacy preview audit still expects placeholders/glyph arrows and has to be replaced in Phase 7.
- A short line-1 hunk collapses to VS Code's “More Actions…” overflow; this is accepted and must be exercised by the audit.
