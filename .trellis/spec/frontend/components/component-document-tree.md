# Component Spec — DocumentTreeView

> Built from `component-template.md`. Owns the virtualized Document tree surface.

## Scope / Trigger

Owns `src/webview/components/documentTree/` (`documentTreeView.ts`, `documentTreeState.ts`,
`documentRows.ts`, `documentTree.css`): the header, native scroller, spacers, virtual window, shared
tree-state helpers and row markup for the Document tree. Hosts own the row model, height function,
selection, search, details and diff status.

Boundary rule: one component, one root; no host globals, no `vscode`, no provider messages.

## Layout

```text
src/webview/components/documentTree/
    documentTreeView.ts    component class
    documentTreeState.ts   collapse/selection/guide helpers
    documentRows.ts        node/brace/comment builders
    documentTree.css       component-owned styles
src/webview/editorViewer.ts / diffViewer.ts   composition roots
src/test/webview/components/documentTree.test.ts
```

## Contract

```typescript
interface DocumentTreeViewModel {
    rowCount: number;
    heightFn(index: number): number;
    renderRow(index: number, pane: string): HTMLElement;
    contentWidth?: number;
}
interface DocumentTreeViewCallbacks {
    onVisibleWindowChange?(top: number, left: number): void;
    onRender?(range: [number, number]): void;
    onRowClick?(index: number, event: MouseEvent): void;
}
class DocumentTreeView {
    constructor(rootSelector: string, pane: string, callbacks?: DocumentTreeViewCallbacks);
    mount(): void;
    setModel(model: DocumentTreeViewModel): void;
    setHeader(header?: DocumentTreeHeader): void;
    setContentWidth(width: number): void;
    render(force?: boolean): void;
    padTopHeight(): number;
    headerHeight(): number;
    getRowsScrollTop(): number;
    setRowsScrollTop(offset: number): void;
    setScrollTop(top: number): void;
    getScrollTop(): number;
    setScrollLeft(left: number): void;
    getScrollLeft(): number;
    clientHeight(): number;
    scrollToIndex(index: number, align?: 'auto' | 'start' | 'end'): void;
}
```

## Rules

- Owns `root > scroll > header + spacers + window`; the header is the scroller's first content element and scrolls away with the rows. Native two-axis scrollbars.
- `headerHeight()` is the measured `header.offsetHeight`, cached and invalidated by `setHeader`/`mount` and by a scroller width change (a resize can reflow the lines); plain scroll renders reuse it. `0` while unmeasurable (jsdom has no layout).
- Row math subtracts `padTopHeight() + headerHeight()` in `getRowsScrollTop()` and adds both back in `setRowsScrollTop()`. `getScrollTop()`/`setScrollTop()` stay the native values so two panes can synchronize them.
- `scrollToIndex`, `virtualState` and `getVisibleRange` inherit the corrected offset; no other scroll math changes.
- A refresh or view switch while any part of the header is on screen restores the native scroll offset, so the header does not jump out of view.
- The header is presentation-only: not a tree item, not a tab stop, and not part of any row haystack. `header.lines` pads the shorter pane so both headers measure equal.
- Renders only the visible window plus overscan; incremental edge updates on scroll.
- Render-key skip when range, total height, viewport and revision are unchanged.
- Shift+wheel maps to horizontal; plain wheel stays vertical.
- Host supplies rows and status; the editor never supplies a diff status.
- Root-scoped; two instances must coexist without id collisions.
- No size math in TS beyond virtual spacer offsets.

## Behaviour

- Annotation, node and brace rows in display order; the Document host sets the module gap on the first row. The diff host sets no gap.
- Guides nested by ancestor level; closing brace rows carry ancestors only.
- Status tint is a diff-only render input applied by the host callback.
- Node, brace and comment rows inside a selected subtree carry `data-subtree`; the selected row itself uses selection state.
- A comment node carries `rowId` for hover/guide lookups and `data-subtree` when its owning row is inside the selection; it stays `aria-hidden`, has no tab stop and a click does nothing.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty model | Empty state, zero spacers |
| Large model | Rendered DOM bounded by viewport + overscan |
| Programmatic scroll | Expected offset suppresses feedback notifications |
| Header present | Rows start below the measured header; the header scrolls out of view |
| Two instances | Independent scrollers, no shared DOM ids |

## Tests Required

`src/test/webview/components/documentTree.test.ts`: window bounds, spacer heights, render-key skip,
incremental update, scroll setters, Shift+wheel, root scoping, DOM order `scroll > header`, header-height
offset arithmetic with a stubbed `offsetHeight`, cached across scroll renders, and `scrollToIndex`
landing rows after the header.

`src/test/webview/page/render.test.ts`: selecting a container highlights a descendant sub-container's
annotation row, clicking an annotation does not change the selection, and node/brace/comment rows carry
`data-subtree` only inside the selected subtree.

## Anti-patterns

- Component reading editor/diff host state or posting messages.
- Host writing row DOM directly instead of supplying `renderRow` output.
- Full-list render or per-row layout reads.
