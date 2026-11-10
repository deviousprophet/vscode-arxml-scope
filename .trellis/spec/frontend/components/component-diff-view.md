# Component Spec — DiffView

> Built from `component-template.md`. Owns the two-pane comparison surface.

## Scope / Trigger

Owns `src/webview/components/diffView/` (`diffView.ts`, `diffViewRender.ts`, `diffView.css`): the fixed
file-name strip, one shared `VirtualScroll` and two `DocumentTreeView` window renderers. `diffViewRender.ts`
is the pure body markup; `diffView.ts` is the mount/header/scroll controller. Host owns the diff model,
view mode, selection, search, status and toolbar.

## Layout

```text
src/webview/components/diffView/
    diffView.ts          fixed header + shared scroll composition
    diffViewRender.ts    pure page/body markup
    diffView.css         component styles
src/webview/diffViewer.ts    composition root
src/test/webview/components/diffView.test.ts
```

## Contract

```typescript
interface DiffViewCallbacks {
    onRowClick?(pane: 'left' | 'right', index: number, event: MouseEvent): void;
    onRender?(pane: string): void;
    onViewportChange?(viewport: DocumentTreeViewport): void;
}
class DiffView {
    constructor(callbacks?: DiffViewCallbacks);
    mount(): void;
    render(viewport: DocumentTreeViewport, force: boolean): void;
    setModel(model: DocumentTreeViewModel): void;
    setContent(content: VirtualScrollContent): void;
    setHeader(header: { left: DocumentTreeHeader; right: DocumentTreeHeader }): void;
    setContentWidth(width: number): void;
    setScrollTop(top: number, defer?: boolean): void;
    setScrollLeft(left: number, defer?: boolean): void;
    getScrollLeft(index?: number): number;
    resetHorizontal(): void;
    refreshActiveLine(): void;
    lineNumberChars(): [number, number];
}
```

## Rules

- The fixed file-name strip sits above the shared `VirtualScroll` and never scrolls. It is one row split into two columns at the pane divider; each column shows the shortest distinguishing label with the full path in its tooltip. `Swap sides` swaps the columns.
- One `VirtualScroll` owns the vertical surface and the offsets. It creates the two pane layers and
  the two `DocumentTreeView` windows; there is one vertical bar and one horizontal bar per pane. The
  pane split stays fixed and moving either horizontal bar pans both panes in sync.
- Both panes render the same virtual row index from one shared offsets table. Header rows are the first virtual rows; they are padded to the longer side with blank rows so the first compared row starts at the same y. When a header exists, one blank `diff-header-gap-row` follows the padded headers and precedes the first compared row; it has no rule child or border. When `moduleGaps` is set, one shared blank `diff-module-gap-row` is inserted before the first visible line (annotation or node) of every module after the first.
- Each pane also mounts its own `DocumentTreeView` line-number gutter. The host numbers each pane's display lines independently; a padded header line or a row missing on that side leaves that pane's cell blank, and a hidden unchanged-run row is not numbered. `lineNumberChars()` exposes the per-pane column width so the host can add it to that pane's content width.
- Vertical and horizontal position belong to `VirtualScroll`. `Swap sides` resets horizontal only; vertical position is preserved.
- Header rows are content: they scroll with the rows, use the document row shell and are searchable. One aligned header row is one search candidate with the combined left/right haystack. The keyword and the value both receive the search mark; the current header row uses the strong tier.
- The header gap is `role="presentation"`, `aria-hidden`, non-focusable and has no `data-key`; it counts as one virtual row in both panes, is numbered on both sides, and never participates in selection, search or F7.
- The module gap is a shared blank display row: `role="presentation"`, `aria-hidden`, `tabIndex=-1`, no `data-key`, no status, no cell and no rule. Both panes render it at the same virtual index and both gutters number it. A module hidden by Show diff/Context produces no gap, and the first visible module has none.
- Every diff row is the base row height, including the shared module gap; no `data-gap` padding marker exists on this surface.
- The pane window is never narrower than the pane or the published full content width (`min-width: max(100%, var(--document-tree-content-width, 0px))`). The published width is the diff text width plus the wider pane's number column (both panes share one model), so it covers each pane's horizontal extent; `measureDiffWidth` includes the header lines, so a long package/schema line cannot exceed the minimum. The window renderer keeps a measurement monotonic within one model, while `setModel` resets to that model's full width.
- Split line is 3px and diff-specific; the editor's resizer and pane sashes are 6px.
- Status tint is diff-only; Document view never sets it. The gutter cell repeats the `diffEditorGutter-*` tint with the diff line-background fallbacks, and the pane-side 3px rails hidden by the overlay are redrawn on the gutter cell: left changed/removed and right added.
- A changed row may carry a word diff for the fields it displays (label, value/target, condition,
  variant, context). Repeated condition/variant/context chips pair by display index, so every chip
  highlights its own pair. Added/removed rows never carry one: their full-cell tint is the only
  treatment.
- Word runs are chosen from the displayed side, so Swap mirrors removed/inserted colours with the panes.
- Search `<mark>` keeps its own background inside a changed word; the word span keeps its 1px outline.
- One `selectedKey` drives selection in both panes. The subtree key set is recomputed from the merged
  rows (the selected row's `subtreeSize` range) and passed to both panes, so node, brace and annotation
  rows highlight together. An added/removed row's blank side renders no cell and no phantom highlight.
- `refreshActiveLine()` re-applies `data-active` on both gutters after a selection change; only the selected display row's numbered cells are active and a blank missing-side cell never is.

## Behaviour

- Both panes show the same aligned display row; each side renders its own node/brace/comment/blank/header line, the shared module gap, or its own line number.
- Header rows do not change the ECUC selection or Details; search can focus and highlight them.
- A changed row renders unchanged words normally and wraps changed runs in
  `.word-changed[data-word-side="left|right"]`; changed runs still go through the field writer, so
  condition token colours and search marks survive. Only rendered rows compute word pairs.
- `buildLineNumbers` renumbers every pane after a model rebuild: Show diff/Show all, Context, Swap,
  Collapse/Expand, a refresh and a header change.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| One-sided row | Opposite cell blank and that gutter cell blank, row stays aligned |
| Swap | Header columns and pane sides flip, horizontal resets, vertical holds, numbers follow the displayed sides |
| Large diff | One shared scroll window; both panes virtualized by the same offsets and bounded gutter cells |
| Header line count differs | Blank rows pad the shorter side, the first compared row aligns, the padded gutter cell stays blank |
| Header gap | One inert blank line follows the padded headers, numbered on both sides; absent with no header |
| Module gap | One shared inert blank line before every module after the first; numbered on both sides; absent before the first visible module and before a module hidden by Show diff/Context |
| Hidden unchanged run | Split line is not numbered; visible numbers around it stay contiguous |
| Short selected row | Both panes fill at least the pane or the published content width, including header lines |
| Added/removed row | Full-cell tint, no word spans, tint and rail only on the owning side's gutter cell |
| Search match inside a changed word | `<mark>` background inside the outlined word span |

## Tests Required

`src/test/webview/components/diffView.test.ts`: fixed title strip with an aligned divider, one
VirtualScroll, two window panes with per-pane horizontal bars and gutters, independent gutter widths
and ranges, shared content geometry, swap reset and header update, no host model access.
`src/test/webview/page/diffPage.test.ts`: loading state before the first document, fixed file names
outside the scroll surface, header rows as content and search candidates with keyword/value marks,
header padding, header gap as one blank numbered line in both panes, the shared module gap at one
virtual index in both panes with both gutters numbering it and no key/status/cell/click target, its
absence for the first visible or a hidden module, independent horizontal bars,
per-pane numbering with blank missing sides and unnumbered hidden runs, renumbering after
Show diff/Context/swap/collapse, the active number, a fixed horizontal gutter, changed-word runs in
both panes, swapped colours, search overlap, no word spans on added/removed, unchanged rows, the base
row height of every row including the gap, no `data-gap`, a content width that includes the header
lines; selecting a container highlights the same subtree and annotation rows in
both panes, a new selection drops the old subtree, and an added/removed row highlights only its owning
pane.
`src/test/core/wordDiff.test.ts`: tokenizer, LCS, empty sides and segment merging.

## Anti-patterns

- Diff host writing pane row DOM directly.
- Per-pane horizontal offsets that drift.
- Two visible vertical scrollbars.
- One shared gutter for both panes, copying a number into a side that has no line, or translating the gutter with the pane window.
- Painting the diff status tint only on the row cell so the gutter overlay hides the left rail.
