# Design — schema/package content rows and one diff scroll

## Decisions so far

- **D1 — Header representation.** The schema/package lines are first-class rows in the same virtual row list as document rows. One `rowCount`, one `heightFn`, one `renderRow` and one search candidate list. The pinned `.document-tree-header` block is removed.
- **D2 — Header interaction.** A header row is a text-line row: it renders, scrolls, searches, receives focus and accepts a click like a document line, but it never posts an ECUC `select` and never changes Details. Search jumps can land on and highlight a header row.
- **D3 — Separate virtual scroll component.** Vertical scrolling is owned by a `VirtualScroll` component, not by either docs view and not by the diff wrapper. The docs view builds content for the virtual scroll. A single docs view is `VirtualScroll > DocumentTreeView`; the diff is `VirtualScroll > left DocumentTreeView + right DocumentTreeView`, sharing one vertical offset. The two diff panes no longer own independent vertical scrollers.
- **D4 — Real height data.** The docs view reports its real row heights to VirtualScroll, not a uniform line height. Module gaps, header rows and any other variable-height row stay accurate for the thumb and for scrollbar dragging.
- **D5 — Precomputed offsets.** The docs view builds cumulative `offsets[0..rowCount]` and `totalHeight` whenever rows or heights change. VirtualScroll binary-searches that array for the visible range and drag position; scroll frames do no per-frame height math. A typed array is an implementation detail, not a contract change.
- **D6 — One shared diff model.** The diff’s aligned display rows produce one `rowCount` and one `offsets` array. Both docs views render their side of the same row index; header rows are padded to the same count before the first compared row. VirtualScroll has one geometry, so the thumb, drag and both panes cannot drift.
- **D7 — Fixed diff file name.** The diff keeps its file-name strip outside the `VirtualScroll`. It is fixed chrome and is never part of the scrollable content. The docs view has no file-name strip.
- **D8 — One fixed strip, two columns.** A single fixed chrome row above the shared `VirtualScroll` is split at the pane divider: left file name over the left pane, right file name over the right, each with its full-path tooltip. `Swap sides` swaps the columns.
- **D9 — Both axes in VirtualScroll.** VirtualScroll owns one vertical and one horizontal scrollbar. In the diff, both panes pan horizontally together; header rows and content rows share the horizontal offset. The docs view and the diff use the same scroll contract, and each docs view is a pure window renderer.
- **D10 — Paired diff header search.** Header rows are aligned by line index and padded to the same count. Search has one candidate per aligned header row, with the left and right text combined in its haystack. A match jumps to that row and highlights the matching side(s); the count stays one per visible line.
- **D11 — Document row appearance.** Header rows use the document row shell: same height, content padding, monospace font, hover and focus treatment. The `schema` / `package` keyword styling stays. No fold twisty and no ECUC selection highlight.
- **D12 — Blank header padding.** The shorter diff header is padded with blank rows to the longer side. Padding rows are not searchable, not focusable and are not ECUC content. The first compared row therefore starts at the same y in both panes.

## Target architecture

```text
DiffView
  fixed file-name strip (outside VirtualScroll, two columns)
  VirtualScroll
    shared offsets / total height / horizontal offset
    left DocumentTreeView window
    right DocumentTreeView window

EditorView
  VirtualScroll
    DocumentTreeView window
```

- `VirtualScroll` owns the scroll surface, the scrollbars, the visible range and the shared offsets. It receives `rowCount`, `offsets`, `totalHeight` and `contentWidth` from the docs view.
- `DocumentTreeView` becomes a window renderer: it receives the visible range, the offsets and the pane side, renders only that slice, and no longer owns a vertical scroller or a pinned header.
- Both diff panes render from the same `offsets`; the pane split is fixed while the shared horizontal offset translates each pane's content.
- Header rows are the first entries in the shared row list. In the diff they are aligned and blank-padded; in the single docs view they are simply the first rows.
- Search uses the shared row list (or a candidate adapter over it) so header rows and content rows share one result count.
- `Swap sides` swaps the fixed file-name columns, the pane content and the header-row order; the scroll geometry is unchanged.

## Current ownership

- `DocumentTreeView`: root, optional title bar, pinned meta, native scroller, spacers, rendered window, scroll offsets, click/focus.
- `editorViewer`: row store, display rows, height function, selection, search, sidebar, Details.
- `virtualScroll`: cumulative heights, total height, row offset, visible range; cached per row set.
- `DiffView`: two `DocumentTreeView` instances with mirrored offsets.
