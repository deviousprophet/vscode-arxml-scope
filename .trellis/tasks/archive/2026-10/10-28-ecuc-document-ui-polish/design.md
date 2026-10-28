# Design: ECUC Document-only UI polish and details editing

Read with `prd.md`. This builds on the virtual row/window design from
`10-28-ecuc-virtualized-render-search` (archived). The row index, flatten/filter engine and virtual
window stay; the presentation and edit entry point change.

## 1. Current -> target

Current:

```text
toolbar: Filter | count | collapse/expand | Document | Tree | Details
Document: source-line gutter | fold column | text | inline .value editor on click/F2
Tree:     two-line grid, glyphs, chips, dotted values
details:  fields + Source + Reveal + Copy path + Copy value
```

Target:

```text
toolbar: Filter | count | collapse/expand | Details
Document: text (no gutter numbers) | fold column | bracket guides | read-only values
details:  fields + editable value input for parameters + Reveal in source
```

The flat `role="tree"` container, `aria-level/posinset/setsize`, collapse/filter state, virtual window
and row data remain. The page is Document-only; `body[data-view="document"]` stays as a static style
scope (there is no alternate value), so the existing CSP-safe attribute CSS does not need a wholesale
selector rewrite.

## 2. Remove the Tree view

- Delete the `#view-toggle` button, `.view-switch` styles, `viewToggle` lookup, `applyView`,
  `toggleView`, and the `view` member of `RowState`/`reconcileRowState`.
- `viewState` becomes `uiState` holding only `inspectorHidden`. A saved object from the previous
  version may carry `view`; it is ignored. `vscode.setState({ inspectorHidden })`.
- Remove the `body[data-view="tree"]` block, Tree row heights (`--tree-row-h*`), Tree probes,
  `heights.treeShort/treeTall`, the `buildHeightFn` branch, and `braces: viewState.view === ...`
  (Document always emits braces).
- Remove `.glyph`, `.g-*`, Tree grid columns, per-kind `border-left` accents, chips/dotted-value
  styles and the Tree-only tests/captures/docs. Keep `data-kind` on rows for Document label tokens.
  `svgIcon` collapses to the twisty icon; `glyphSpan` is deleted.
- The Document row becomes the base flex row (it was already the Document override); the fold
  column becomes an inline 2ch flex item rather than an absolutely positioned gutter element.
- Keep `#tree`, `role="tree"`, `aria-*`, `data-node-id` and `data-level`: these are the accessible
  tree/document structure, not the removed Tree presentation.

## 3. Remove line numbers and the gutter

- Remove `RenderOptions.lineIndex`, `RowBuildOptions.lineIndex`, `RowDocument.digits`,
  `RowPayload.digits`, `EcucRow.sourceLine/line/column/endLine/endColumn`, `buildRows`'s
  `sourceFields`/`maxLine`, and `InspectorFields.source`.
- Provider `renderHtml`/`buildRows` no longer construct a `LineIndex`; the re-scan payload is
  `{ type: 'model', rows, selectedId }`.
- Remove `data-line`, `data-ln-digits`, `#tree[data-ln-digits]` selectors, `.row::before` line
  numbers, `--ln-w/--ln-digits/--gut` and the active-line-number rule.
- New geometry:
  - `--doc-pad: 3ch` (narrow: `2.5ch`), `--indent: 4ch` (narrow: `3ch`), `--fold: 2ch`.
  - `.row` is `display:flex; gap:1ch; padding-left: var(--doc-pad);` with generated level rules:
    `padding-left: calc(var(--doc-pad) + var(--indent) * (level - 1))`.
  - The twisty/spacer is a `flex: 0 0 2ch` item before the label; leaves keep the spacer so labels
    align.
  - Braces use the same level padding; the brace mark is the only child.
  - `.meta` and the empty state align at `--doc-pad`; `#tree` keeps its top/bottom padding.
  - Selection tint/rail still covers the whole row; the rail stays at the row's left edge.
- Horizontal scrolling and `white-space: pre` stay; no wrap/truncation.

## 4. Bracket guides and selection hierarchy

Two pure, serialized helpers:

```ts
export function subtreeRowIds(
  selectedId: string | undefined,
  rows: readonly { id: string; subtreeSize: number }[]
): string[]

export function guidesFor(
  displayRows: readonly FlatRow[],
  rows: readonly { id: string }[]
): { level: number; id: string }[][]
```

- `subtreeRowIds` returns the selected row plus every descendant in display order, using
  `subtreeSize`; a missing selection returns `[]`.
- `guidesFor` walks the displayed list with an open-container stack. A `brace-open` starts a guide
  for that container's level/id on the following rows; a `brace-close` ends it. Header rows and the
  opening brace carry only outer guides; nested containers add their own segment.
- Each rendered node/brace row appends one absolute `.guide` span per open container, with
  `data-level` and `data-container-id`. CSS positions each level at
  `calc(var(--doc-pad) + var(--indent) * (level - 1) + 3.5ch)` (the brace column).
- Guides are always present, `opacity: .28`; hovering a container (or a row in its subtree) sets
  `hoveredGuideId`, and every rendered guide with that container id gets `guide-active`
  (`opacity: .85`). Rebuilds reapply the hover class.
- No repeating background gradient, no selected-branch dependency. The guide follows
  collapse/filter/scroll because `guideLevels` is recomputed from `displayRows`.
- Selection:
  - `subtreeIds = new Set(subtreeRowIds(selectedId, rows))`; `setRows`/`setSelection` recompute it.
  - `buildNodeRow` sets `data-subtree` on rendered descendants (not the selected row); brace nodes
    with `data-row-id` in the set also get it, so the tint is continuous.
  - CSS: `.node[data-subtree] > .row` and `.brace[data-subtree] > .row` use `--subtree-bg`
    (`--vscode-editor-selectionHighlightBackground` mixed down).
  - A selected parameter gets `--sel-bg-focus`, the 2px rail and a 1px `--sel-outline`, so it is
    clearly stronger than a container subtree tint. Selection still never recolours syntax.
- Guides and subtree markers are decorative/aria-hidden; they do not change collapse/filter state.

## 4b. Controls, colours and dark-only theme

- The toolbar Collapse/Expand buttons use 14px icons, `min-width: 28px`, `padding: 0 8px` and visible
  `Collapse`/`Expand` labels; labels hide at <=720px. The row twisty is 12px at 0.7 opacity at rest,
  stretches to the full row height so the hit area is the line, and reaches 1 on hover/focus.
- Container labels use `--vscode-symbolIcon-namespaceForeground` (fallback `#4EC9B0`, the C
  typedef/type green). Reference `.value-text` uses `--vscode-symbolIcon-functionForeground`
  (fallback `#DCDCAA`) and `font-style: italic`. Other labels stay neutral/key-accented.
- Dark is the supported theme. Remove the light-theme overrides; the selection tint is the 10% dark
  mix for all hosts. High contrast/forced colors remain the accessibility variant. The preview
  harness exposes only `dark` and `hc`.

## 5. Document is read-only for values

- `.value` remains a direct child of `.row`; no input is inserted into it.
- Remove the inline value editor (`valueEdit`, `beginValueEdit`, `closeValueEdit`,
  `detachValueEdit`, `reattachValueEdit`, `.value-edit`, `.value-error`, the Document `.value` hover
  pencil/pseudo hint, and the first-listener document click/key handler).
- Parameter value title becomes `"Value: <shown> - edit in Details"`; no F2/click-to-edit hint.
- `onRowClick`:
  - `.twisty` -> toggle, unchanged.
  - followable reference `.value`/target -> follow; unresolved target falls through to select.
  - parameter `.value-text` -> `selectItem` + `beginDetailsEdit(id)`.
  - parameter `=`/label/other row area -> `selectItem` only.
- Keyboard:
  - `F2` on a focused parameter -> `beginDetailsEdit(id)`.
  - `Enter` on a focused parameter -> `beginDetailsEdit(id)`; on a container -> toggle; on a
    followable reference -> follow; otherwise reveal (Ctrl/Alt+Enter still reveals any row).
  - `Space` selects; arrows/Home/End/PageUp/PageDown/type-ahead unchanged.
- The details value input is the only editable value surface.

## 6. Details panel editor

Rename `src/editor/ecucValueEditor.ts` to `src/editor/ecucDetailsEditor.ts` and export
`detailsEditorScript()`. It is emitted before the page script in the same classic script, so its
functions can be called by `updateInspector`/`onRowClick`/`onTreeKeydown`.

State/flow:

```ts
let detailsEdit = { rowId, input, pending, error } | null;
let pendingMove = null;   // { dir, from }
let flashId = null;
```

- `updateInspector` (page) builds the usual kind/label/fields. For a parameter it calls
  `detailsValueInput(row, data)` from the details editor to get a row containing:
  - `<input class="details-value" type="text" value="<row.value>">`
  - a `.details-value-error` placeholder/`aria-live` span.
  The input has `aria-label="Value of <label>"`, `data-node-id`, and `spellcheck=false`.
  It is visible and editable but not focused until `beginDetailsEdit`.
- `beginDetailsEdit(rowId)`:
  1. If the row is not a parameter, return false.
  2. Ensure details are visible: `uiState.inspectorHidden=false`, `applyInspectorVisibility()`,
     `vscode.setState(uiState)`.
  3. If the row is not selected, `setSelection(rowId)` (this calls `updateInspector`); otherwise
     `updateInspector()` if the input is stale.
  4. `focusDetailsInput()` (selects the text).
- Input keyboard:
  - `Enter`: prevent default, `commitDetailsEdit()`.
  - `Escape`: prevent default, restore `input.value = row.value`, clear the error/invalid state,
    keep focus.
  - `Tab`/`Shift+Tab`: prevent default, set `pendingMove`, `commitDetailsEdit()`.
  - `input` event clears the invalid marker? Keep invalid until the next commit or Escape.
- `commitDetailsEdit` posts `{ type: 'edit', nodeId: rowId, value: input.value }` (the existing
  write path), sets `pending=true`, clears the previous error, and stores `flashId`.
- Host `model` message (successful edit or any re-scan):
  - Clear `pending`/`detailsEdit`; if `pendingMove`, schedule `focusAdjacentParameter` then
    `beginDetailsEdit(nextId)`; if `flashId`, schedule `flashRow`; page rebuilds rows/inspector.
- Host `notice` with `kind: 'warn'` while pending:
  - Keep the input/text, set `aria-invalid`, show `/* reason */` in the error span, clear pending and
    pendingMove. The page's notice still shows the same reason.
- `flashRow(nodeId)` uses `renderedItemFor(nodeId)` (flat row map) and flashes the Document row.
- `focusAdjacentParameter` stays page-side; it focuses/scrolls the next parameter. The details
  editor then selects it and focuses the details input. If no next/previous parameter, do nothing.
- Clicking another row while not pending discards the current edit (no implicit write), matching the
  old click-outside behavior. There is no blur-commit.

Panel cleanup:

- `InspectorFields` loses `source`; `updateInspector` stops rendering the Source row.
- `updateInspector` actions contain only `Reveal in source`.
- Remove the Copy path/Copy value/Copy target buttons, the `type: 'copy'` message, the `text`
  message field, the provider copy branch, `copyText`, `src/editor/clipboard.ts` and
  `src/test/editor/copy.test.ts` (no other production caller).
- Keep `Reveal in source`, target follow, details toggle and `aria-controls`.

## 7. Data and provider contracts

`buildRows(model, options?)` keeps the display/order rules and the compact row fields used by the
Document/details panel, but removes source position fields and `digits`:

```ts
interface EcucRow {
  id; kind; level; parentId; subtreeSize; posinset; setsize; hasChildren;
  label; shortName?; definitionRef; value?; valueKind?; shownValue?; target?; followable?;
  contextPaths?; title; meta; haystack;
}
interface RowDocument { rows: EcucRow[] }
interface RowPayload { rows: EcucRow[]; selectedId?: string }
```

- `renderHtml` embeds `{ rows, selectedId }`; `encodeRowDocument` is unchanged (escapes `<`).
- `ecucEditorProvider` initial/push calls `buildRows(model, { ...settings, selectedId })`; no
  `LineIndex`. The re-scan message keeps `type: 'model'` for the value widget, with `rows` and
  `selectedId`.
- `preview-ecuc.js`/`bench-ecuc.js` drop the `digits`/line-index assumptions and the `?view=tree`
  option. `preview:check` asserts the Document shell (no view toggle, virtual spacers/window,
  inspector) and the row payload.
- `RowState` = `{ selectedId?, collapsed, query }`; `reconcileRowState` no view.

## 8. Accessibility and keyboard

- The flat tree keeps `role="tree"`, `role="treeitem"`, `aria-level`, `aria-posinset`,
  `aria-setsize`, `aria-expanded`, `aria-selected` and roving `tabindex`.
- Details value input: `aria-label="Value of <label>"`, `aria-invalid` on refusal, error span
  `role="status"`/`aria-live="polite"`; the input is keyboard reachable only through the details
  panel / `F2`/`Enter` entry.
- The Document remains fully keyboard-navigable; the details input is outside `#tree`, so tree key
  handling does not swallow its keys and it does not need `stopImmediatePropagation` for Document
  events. The details input still stops `Enter`/`Tab`/`Escape` propagation.
- Bracket guides are decorative `aria-hidden` spans; the subtree tint is presentational only.
- Reduce motion/high contrast rules stay; the details input uses `--vscode-input-*` and focus border.
- The screen-reader window limitation remains documented.

## 9. Verification and captures

- Row model: no source/digits fields; ordering/meta/value/target/context/haystack unchanged.
- Document shell: no view toggle, no Tree CSS/probes/glyphs, no line numbers, compact shell, one
  measurement probe, virtual spacers/window, details panel.
- Bracket guides: pure `guidesFor` tests for open/close/nesting/headers; page source/window tests for
  `.guide` spans, `guide-active` hover and no global gradient; captures with a deep open container.
- Details editing: source-level tests for input creation, click/F2/Enter entry, Enter/Escape/Tab,
  refusal/error, successful re-scan/flash and Reveal-only actions; browser capture of focused/
  invalid input.
- Filter/collapse/re-scan/a11y tests updated to Document-only.
- Captures: dark and HC; selected parameter, selected container subtree, guide hover, details
  closed/open/editing/invalid, filtered/empty, narrow, deep, large, huge. No tree or light captures.
- Performance: harness load/filter/DOM count and payload size before/after; removing Tree/line
  fields should reduce the payload. Record engine vs debounce.
- Mutation checks (21): Tree toggle, line attribute, repeating gradient, guide computation/leak,
  inline editor style, F2 hint, Source row, Copy action, details commit, digits re-scan, Tree glyph
  CSS, container accent, followable, subtree leak, collapse labels, twisty hit area, scroll padding,
  HC subtree fill, brace hover, pending draft.
- Full gates: `check-types`, `lint`, `test`, `preview:check`.

## 10. Risks and rollback

| Risk | Mitigation |
|---|---|
| Tree removal breaks collapse/filter/focus | Keep the flat tree and filter engine; run all interaction tests; mutation check the toggle is gone, not collapse |
| No-line-number geometry misaligns braces/header | Shared `--doc-pad`/`--indent` rules; captures at multiple levels/narrow |
| Bracket guide leaks outside its container | Pure `guidesFor` + only open-container spans; capture a deep container |
| Subtree tint leaks to siblings | Pure `subtreeRowIds` + `data-subtree`/`data-row-id` only; selection capture |
| Details editing loses validation/focus | Reuse the existing edit message/write path; tests for commit/refusal/Tab/Escape; capture error state |
| Copy removal leaves dead provider code | Delete clipboard module/test and provider branch; gate `copy` absent |
| Design spec contradicts the product | Update the design spec and frontend specs in the same task |
| Payload/performance regression | Removing fields should shrink it; measure harness |

Rollback: revert the renderer/details/provider/docs commit. The virtual row/window engine and
`src/core/**` are untouched.

## 11. Wrong vs correct

**Wrong - hide the Tree mode.**

```css
.view-switch { display: none; }
```

The toggle, state, CSS and tests still exist.

**Correct - delete the view.**

```text
no view-toggle, no view state, no Tree selectors/probes/glyphs; Document is the only renderer
```

**Wrong - keep line numbers but change their meaning.**

```text
display 1..N in the old gutter
```

The user asked for no meaningless numbering; the gutter goes.

**Wrong - draw guides on every level and then dim them.**

```css
.row { background-image: repeating-linear-gradient(...); opacity: .3; }
```

The long vertical line remains.

**Correct - one guide per open container, from brace to brace.**

```ts
guideLevels = guidesFor(displayRows, rows);
const guides = guideLevels[displayIndex] || [];
span.dataset.level = String(guide.level);
span.dataset.containerId = guide.id;
```

**Wrong - insert the editor into `.value` again.**

```ts
span.querySelector('.value-text').after(input);
```

The document surface becomes an editor and the click target still includes `=`.

**Correct - edit in the details panel.**

```ts
selectItem(item);
beginDetailsEdit(id); // focuses the details input
```

**Wrong - copy/source rows remain as hidden or small actions.**

```text
Source / Copy path / Copy value
```

They are removed from the panel and host, not hidden.
