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
- Pane headers include file label plus schema/package lines, padded to equal height.
- Split line is 3px and diff-specific; the editor's resizer and pane sashes are 6px.
- Status tint is diff-only; Document view never sets it.

## Behaviour

- Both panes show the same aligned display row; each side renders its own node/brace/comment/blank.
- Pane drivers mirror offsets without feedback loops.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| One-sided row | Opposite cell blank, row stays aligned |
| Swap | Header/value/reveal sides flip, horizontal resets, vertical holds |
| Large diff | Both panes virtualize independently |

## Tests Required

`src/test/webview/components/diffView.test.ts`: two scrollers, single vertical driver, horizontal
mirror, swap reset, header parity, status optional.

## Anti-patterns

- Diff host writing pane row DOM directly.
- Per-pane horizontal offsets that drift.
- Two visible vertical scrollbars.
