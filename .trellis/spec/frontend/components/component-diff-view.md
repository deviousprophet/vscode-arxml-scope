# Component Spec — DiffView

> Built from `component-template.md`. Owns the two-pane comparison surface.

## Scope / Trigger

Owns `src/webview/components/diffView/` (`diffView.ts`, `diffViewRender.ts`, `diffView.css`): the
50/50 pane grid, two `DocumentTreeView` instances, pane headers and synchronized vertical/horizontal
offsets. `diffViewRender.ts` is the pure body markup; `diffView.ts` is the mount/sync controller. Host
owns the diff model, view mode, selection, search, status and toolbar.

## Layout

```text
src/webview/components/diffView/
    diffView.ts          pane composition + sync controller
    diffViewRender.ts    pure page/body markup
    diffView.css         component styles
src/webview/diffViewer.ts    composition root
src/test/webview/components/diffView.test.ts
```

## Contract

```typescript
interface DiffViewCallbacks {
    onVisibleWindowChange?(pane: 'left' | 'right', top: number, left: number): void;
    onRowClick?(pane: 'left' | 'right', index: number, event: MouseEvent): void;
}
class DiffView {
    constructor(callbacks?: DiffViewCallbacks);
    mount(): void;
    syncPanes(pane: 'left' | 'right', top: number, left: number): void;
    render(force: boolean): void;
    setModel(model: DocumentTreeViewModel): void;
    setHeader(header: { left: DocumentTreeHeader; right: DocumentTreeHeader }): void;
    setContentWidth(width: number): void;
    setScrollTop(top: number): void;
    setScrollLeft(left: number): void;
    resetHorizontal(): void;
}
```

## Rules

- Each pane owns a `DocumentTreeView`; no shared row DOM.
- Vertical is single-visible: the right pane follows the left driver; either pane wheel mirrors.
- Horizontal: each pane has its own bar; moving either mirrors both.
- Swap resets horizontal offsets only; vertical position is preserved.
- Pane headers include file label plus schema/package lines, live inside each pane's scroller and
  scroll away with the rows. `header.lines` pads the shorter one so both measure equal height.
- Every diff row is the base row height: the Document-only module gap and its `data-gap` marker are
  not part of this surface.
- Split line is 3px and diff-specific; the editor's resizer and pane sashes are 6px.
- Status tint is diff-only; Document view never sets it.
- A changed row may carry a word diff for the fields it displays (label, value/target, condition,
  variant, context). Added/removed rows never carry one: their full-cell tint is the only treatment.
- Word runs are chosen from the displayed side, so Swap mirrors removed/inserted colours with the panes.
- Search `<mark>` keeps its own background inside a changed word; the word span keeps its 1px outline.
- One `selectedKey` drives selection in both panes. The subtree key set is recomputed from the merged
  rows (the selected row's `subtreeSize` range) and passed to both panes, so node, brace and annotation
  rows highlight together. An added/removed row's blank side renders no cell and no phantom highlight.

## Behaviour

- Both panes show the same aligned display row; each side renders its own node/brace/comment/blank.
- Pane drivers mirror offsets without feedback loops.
- A changed row renders unchanged words normally and wraps changed runs in
  `.word-changed[data-word-side="left|right"]`; only rendered rows compute word pairs.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| One-sided row | Opposite cell blank, row stays aligned |
| Swap | Header/value/reveal sides flip, horizontal resets, vertical holds |
| Large diff | Both panes virtualize independently |
| Added/removed row | Full-cell tint, no word spans |
| Search match inside a changed word | `<mark>` background inside the outlined word span |

## Tests Required

`src/test/webview/components/diffView.test.ts`: two scrollers, single vertical driver, horizontal
mirror, swap reset, header parity, status optional, word-colour CSS, no module-gap CSS.
`src/test/webview/page/diffPage.test.ts`: header inside the scroller and not searchable, changed-word
runs in both panes, swapped colours, search overlap, no word spans on added/removed, unchanged rows,
module height and no `data-gap`; selecting a container highlights the same subtree and annotation rows
in both panes, a new selection drops the old subtree, and an added/removed row highlights only its
owning pane.
`src/test/core/wordDiff.test.ts`: tokenizer, LCS, empty sides and segment merging.

## Anti-patterns

- Diff host writing pane row DOM directly.
- Per-pane horizontal offsets that drift.
- Two visible vertical scrollbars.
