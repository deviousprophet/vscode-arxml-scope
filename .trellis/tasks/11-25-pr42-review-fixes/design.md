# Design — PR 42 review fixes

## 1. Merge state

Replace `classList.toggle('arxml-diff-merge', mergeMode)` with
`setAttribute('data-merge', mergeMode ? 'true' : 'false')` on `#diff-monaco`.
CSS becomes `#diff-monaco:not([data-merge="true"]) .gutterItem { display:none; }`.
The preview audit reads the attribute, not a class. `aria-pressed` remains the toolbar
state.

## 2. Body ownership

- Delete `buildAlignedSyntheticDocuments`, `AlignedBuild`, `AlignedSyntheticDocuments`,
  `walkAlignedRow`, `appendRowCells`, `appendChildBlock` and the aligned tests.
- Keep `buildDiffSyntheticDocuments` and its per-side tests.
- Move the hunk mapping helpers (`rowHasSide`, `keyHasSide`, `firstKeyInRange`) into
  `src/webview/monaco/diffBody.ts`, with `DiffGutterRange`/`DiffSide` types imported from
  the action/context module where practical. `diffMonaco.ts` imports them.
- Add `lineNumbersMinChars: 3` and `lineDecorationsWidth: 14` to the diff editor options.
- Remove `renderMarginRevertIcon`; `readOnly: true` hides the built-in Revert.

## 3. Gutter availability

- One lookup: `itemValues(item, host)` returns `GutterAvailability | null`.
  `applyAvailability` uses it and returns on `null`; `snapshotItem` uses the same value.
- Import `DiffGutterMapping`/`DiffGutterRange`; do not re-spell them.
- Rename `canCopy` to `gutterCopyReady` (or `hasCopyContext`) because it checks page and
  mapping readiness.
- Remove `selectedKey`/`selectKey`; the cursor callbacks only need to keep the existing
  selection behavior if something still reads it. If nothing reads it, delete both.
- Keep `__ARXML_GUTTER_AVAILABILITY__` as the Monaco patch contract. Rename the preview
  snapshot to `__ARXML_GUTTER_PROBE__` and set it only when `__PREVIEW__` exists.

## 4. Preview probes

`previewPage.ts`:
- `jumpToChange` dispatches F7 to `#diff-monaco` (or the focused Monaco editor), not the
  removed `#diff-pane-left`.
- `probeGutter` records per-item rendered labels:
  `items: Array<{ labels: string[]; visible: boolean }>`; `buttons` stays for the
  aggregate allowlist.
- Add `probeHover`: dispatch `mouseenter`/`mouseover` on a changed item, wait, record
  the visible labels; assert a changed hunk reveals both. For `diff-removed`/`diff-added`,
  assert only the meaningful label is rendered.
- For the line-1 overflow hunk, click “More Actions…”, wait, and record the submenu
  labels in `overflowLabels`; assert the meaningful labels are present.
- `probeFolding` records both `original` and `modified` visible counts; the toolbar
  actions must collapse and restore both.
- `sash` states: add `sash: true` to `diff-off` (non-Merge) and `diff-swap` (Swap).
  `probeSash` runs before Swap; `probeSashAfterSwap` records afterSwap and reset for
  `diff-swap`. `sashViolations` checks Swap only when `state.swap`.

`previewAudit.ts`:
- Delete the legacy pane/arrow/gutter/placeholder scan functions and fields that the
  Monaco page never populates. Keep only the Monaco `gutterProbe`, `folding`, `sash`,
  native body audit and toolbar/content checks.
- `paneSnapshot`/`swap` must read Monaco titles/model values, or be removed if the new
  audit does not need them.
- `oneSided` audit keeps model/paint/diagonal checks; remove any placeholder/arrow
  selector.
- `availabilityIssues` checks both the snapshot and `gutterProbe.items[].labels`.

## 5. Specs and docs

- `css-guidelines.md`: replace the Diff/selector sections with the Monaco selectors
  (`.monaco-diff-editor`, `.gutter`, `.gutterItem`, `.monaco-sash`, `#diff-monaco[
  data-merge="true"]`), remove old `.diff-row`/`.arxml-diff-placeholder` rules.
- `component-guidelines.md`: `buildDiffSyntheticDocuments` is the only builder.
- `testing.md`: point preview commands/artifacts at the skill; source-contract tests are
  explicitly labelled.
- `directory-structure.md`: remove `diffViewer.ts`/`rowSearch.ts` if still listed.
- `diffCodeParity.test.ts`: rename the suite to “VS Code diff source contract” and each
  test to “source contract: …”; add a comment that it is a static wiring/hash check.
- Archived task PRD/design: record the accepted patch and the `readOnly` Revert decision.

## 6. Changelog

Rewrite `[Unreleased]` from the net diff:
- Added: engine status/restart/chunked upload, find/replace, Monaco editor/diff with
  direct editing/local drafts/undo/redo/save marker/sticky scroll, syntax palette,
  gutter copy actions, resize, folding.
- Changed: platform error naming, editor settings inheritance, per-side diff/native
  paint, native find widget, search mapping, coalesced save, paste newline.
- Removed: custom Document renderer; custom diff margin/placeholders/arrows.
- Fixed: only fixes to released behavior (e.g. bulk-rename semantic pairing); fold
  in-range Monaco/search/engine fixes into the introducing entries.

## 7. Verification

- `npm run check-types`
- `npm run lint`
- `npm run compile-tests` then `npm test --ignore-scripts`
- full preview skill set
- fallow GREEN
- `node esbuild.js --production`
- `git diff --check`
- push and let CI rerun
