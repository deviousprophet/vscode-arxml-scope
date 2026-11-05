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
}
```

## Rules

- The fixed file-name strip sits above the shared `VirtualScroll` and never scrolls. It is one row split into two columns at the pane divider; each column shows the shortest distinguishing label with the full path in its tooltip. `Swap sides` swaps the columns.
- One `VirtualScroll` owns the vertical surface and the offsets. It creates the two pane layers and
  the two `DocumentTreeView` windows; there is one vertical bar and one horizontal bar per pane. The
  pane split stays fixed while each pane's content pans on its own bar.
- Both panes render the same virtual row index from one shared offsets table. Header rows are the first virtual rows; they are padded to the longer side with blank rows so the first compared row starts at the same y.
- Vertical and horizontal position belong to `VirtualScroll`. `Swap sides` resets horizontal only; vertical position is preserved.
- Header rows are content: they scroll with the rows, use the document row shell and are searchable. One aligned header row is one search candidate with the combined left/right haystack.
- Every diff row is the base row height: the Document-only module gap and its `data-gap` marker are not part of this surface.
- Split line is 3px and diff-specific; the editor's resizer and pane sashes are 6px.
- Status tint is diff-only; Document view never sets it.
- A changed row may carry a word diff for the fields it displays (label, value/target, condition,
  variant, context). Repeated condition/variant/context chips pair by display index, so every chip
  highlights its own pair. Added/removed rows never carry one: their full-cell tint is the only
  treatment.
- Word runs are chosen from the displayed side, so Swap mirrors removed/inserted colours with the panes.
- Search `<mark>` keeps its own background inside a changed word; the word span keeps its 1px outline.
- One `selectedKey` drives selection in both panes. The subtree key set is recomputed from the merged
  rows (the selected row's `subtreeSize` range) and passed to both panes, so node, brace and annotation
  rows highlight together. An added/removed row's blank side renders no cell and no phantom highlight.

## Behaviour

- Both panes show the same aligned display row; each side renders its own node/brace/comment/blank or header line.
- Header rows do not change the ECUC selection or Details; search can focus and highlight them.
- A changed row renders unchanged words normally and wraps changed runs in
  `.word-changed[data-word-side="left|right"]`; changed runs still go through the field writer, so
  condition token colours and search marks survive. Only rendered rows compute word pairs.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| One-sided row | Opposite cell blank, row stays aligned |
| Swap | Header columns and pane sides flip, horizontal resets, vertical holds |
| Large diff | One shared scroll window; both panes virtualized by the same offsets |
| Header line count differs | Blank rows pad the shorter side, first compared row aligns |
| Added/removed row | Full-cell tint, no word spans |
| Search match inside a changed word | `<mark>` background inside the outlined word span |

## Tests Required

`src/test/webview/components/diffView.test.ts`: fixed title strip with an aligned divider, one
VirtualScroll, two window panes with per-pane horizontal bars, shared content geometry, swap reset and
header update, no host model access.
`src/test/webview/page/diffPage.test.ts`: loading state before the first document, fixed file names
outside the scroll surface, header rows as content and search candidates, header padding, independent
horizontal bars, changed-word runs in both panes, swapped colours, search overlap, no word spans on
added/removed, unchanged rows, module height and no `data-gap`; selecting a container highlights the
same subtree and annotation rows in both panes, a new selection drops the old subtree, and an
added/removed row highlights only its owning pane.
`src/test/core/wordDiff.test.ts`: tokenizer, LCS, empty sides and segment merging.

## Anti-patterns

- Diff host writing pane row DOM directly.
- Per-pane horizontal offsets that drift.
- Two visible vertical scrollbars.
