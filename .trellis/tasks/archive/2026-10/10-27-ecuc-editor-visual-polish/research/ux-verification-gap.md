# UX task verification gap and contracts to preserve

Extracted from `../10-14-ecuc-editor-ux/implement.md` (36 KB, too large to inject whole). Read the
source file when you need the full evidence.

## The seven manual rows (7/7 unverified before this task)

These need a real Extension Development Host and were **not** observed when the UX child was checked:

1. Click a container's label → selects, no XML appears. *(Gesture unverified; the handler and host
   effect are tested.)*
2. Double-click a container → XML opens beside with the range selected, tree still focused. *(Mode and
   tab behaviour tested; gesture not.)*
3. Collapse a container, type in the XML beside it → still collapsed, scroll has not jumped. *(Seven-step
   re-render order tested; the scroll value needs a layout.)*
4. Hover a row and a value → hover background and edit affordance visible. *(CSS asserted; rendered
   hover not.)*
5. Click a value, type garbage, Enter → refusal message and the typed text still there. *(Script
   asserted; live input not.)*
6. Filter to something inside a collapsed container → ancestor expands, count shown, matches
   highlighted; clearing restores the collapse. *(Script asserted; DOM pass not.)*
7. Repeat 1–4 in light, dark and high-contrast themes → nothing invisible. *(Every colour is a
   `--vscode-*` variable with a non-transparent fallback, asserted; no theme was rendered.)*

The browser harness can observe 1, 3, 4, 6 and 7 **in a browser with stubbed VS Code variables**. It
cannot prove VS Code's own theme resolution, the real custom-editor tab/column/focus behaviour, or the
real host clipboard. Rows 2 and 5 remain real-host checks; the harness can show the page side only.

## Check findings that shaped the code

- **Collapse's hiding rule** (`.node[aria-expanded="false"] > .children { display: none }`) is what
  makes a toggle change the screen; it is asserted now. Do not remove it.
- **The `model` handler's seven hooks** (`readScrollTop`, `writeHtml`, `pruneCollapsed`,
  `applyCollapsed`, `applyFilter`, `prepareFocus`, `writeScrollTop`) are asserted by name. A re-render
  that drops the collapsed-set restore is the R-UX4 defect.
- **Node ids** are declaration-order ordinals from the raw model, not the display order. AC13's
  sort-independence test uses `sibling-sort-order.arxml` because the two orders genuinely disagree.
- **`replace` mode** swaps the group's active tab; the custom editor tab remains open in the
  background. The test asserts both.

## Accepted deviations

- The row is a **flex** row, not the design's two-column grid. This task changes it to a grid but must
  keep `.value` a **direct child of `.row`**; the widget, `highlightableSpans` and `editing.test.ts`
  select `:scope > .row > .value`.
- `#main` is the scroll container (`body` is `overflow: hidden`). The inspector shell must not move
  the scroll container or `reRenderTree`'s capture/restore becomes a no-op.
- `N of M` counts **visible rows**, not matches. `No matches` is the zero case.
- The count badge on a collapsed container was omitted; the toolbar count is the reported state.
- `replace` does not close the custom editor; it is still open in the background.

## Contracts this task must not break

- The value widget's listeners are registered before the tree's and claim events with
  `stopImmediatePropagation` (`src/editor/ecucValueEditor.ts`).
- `matchRanges` is the only definition of a match; filtering and `<mark>` highlighting share it.
- The page is a plain inlined page under `default-src 'none'`; inline SVG is allowed, an asset file or
  remote load is not.
- The custom editor never claims `.arxml` by default (`priority: "option"`).
- `src/core/**` is untouched.
