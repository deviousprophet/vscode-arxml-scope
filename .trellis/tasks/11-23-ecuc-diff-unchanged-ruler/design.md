# Design — unchanged regions and semantic navigation

## 1. Current state

- `diffMonaco.ts` `updateDiffOptions()` already toggles Monaco's native
  `hideUnchangedRegions: { enabled: changesOnly, contextLineCount: contextActive ? 5 : 0,
  minimumLineCount: 3 }`.
- `Show all` sets `changesOnly=false`; `Show diff` sets it true and enables Context; the Context
  toggle changes the context line count.
- The legacy DOM `DiffGap`/`diffViewer` rows are not the shipped Monaco body. Do not build a second
  semantic gap renderer.
- `navigate()` currently uses `diffEditor.getLineChanges()` on the pre-aligned synthetic text,
  which can disagree with semantic changes (renames/moves/placeholders).

## 2. Native unchanged widgets

- Keep the native `hideUnchangedRegions` option and the Show all/Show diff/Context toolbar path.
- Verify and align:
  - widget geometry (height, indentation, chevron, label, hover/focus),
  - context rows above/below,
  - Show diff + Context on/off,
  - placeholder lines not becoming misleading hidden/expanded rows.
- If the native widget geometry cannot be styled sufficiently, scope CSS to the shipped Monaco
  classes; do not replace it with a custom widget unless the child documents why.
- Add a preview state that exercises Show diff + Context and Show all.

## 3. Overview ruler

- Keep Monaco's built-in `renderOverviewRuler` on; it is the same diff overview VS Code uses.
- Do not add semantic `overviewRuler` decorations or a current/selected emphasis.
- Do not use Monaco's `getLineChanges()` as a semantic mark source; there are no semantic marks.

## 4. Semantic previous/next

- Build `semanticChanges()` from `documentModel.rows`:
  - status `changed`/`added`/`removed` (and renamed pairs that are `changed`),
  - target line on the current pane (modified/original/swapped),
  - stable order by semantic row index.
- `navigate(direction)` uses that list, reveals the target, sets the cursor to the row, and
  wraps/ends consistently. The current ARXML toolbar Prev/Next buttons stay.
- Keep search/find behavior; no VS Code toolbar controls.

## 5. Tests / preview

- Unit: semantic change list ordering, target line under swap, end wrapping, skipped placeholders.
- Preview: Show diff/Context geometry, Show all, native `.diffOverview` presence and navigation;
  a semantic rename/move case where Monaco line changes would pick the wrong row.
- Keep `diff-one-sided`, merge, search, collapse and existing audits green.

## 6. Risks / rollback

- Native `hideUnchangedRegions` DOM/options can drift between Monaco versions; the visual-proof
  child audits it.
- Placeholder lines must not be hidden/expanded as real context.
- Rollback: revert the navigation changes and any native-widget CSS; the semantic diff and
  toolbar remain.
