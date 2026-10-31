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
    setContentWidth(width: number): void;
    render(force?: boolean): void;
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

- Owns `root > header + scroll > spacers + window`; native two-axis scrollbars.
- Renders only the visible window plus overscan; incremental edge updates on scroll.
- Render-key skip when range, total height, viewport and revision are unchanged.
- Shift+wheel maps to horizontal; plain wheel stays vertical.
- Host supplies rows and status; the editor never supplies a diff status.
- Root-scoped; two instances must coexist without id collisions.
- No size math in TS beyond virtual spacer offsets.

## Behaviour

- Annotation, node and brace rows in display order; module gap on the first row.
- Guides nested by ancestor level; closing brace rows carry ancestors only.
- Status tint is a diff-only render input applied by the host callback.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty model | Empty state, zero spacers |
| Large model | Rendered DOM bounded by viewport + overscan |
| Programmatic scroll | Expected offset suppresses feedback notifications |
| Two instances | Independent scrollers, no shared DOM ids |

## Tests Required

`src/test/webview/components/documentTree.test.ts`: window bounds, spacer heights, render-key skip,
incremental update, scroll setters, Shift+wheel, root scoping.

## Anti-patterns

- Component reading editor/diff host state or posting messages.
- Host writing row DOM directly instead of supplying `renderRow` output.
- Full-list render or per-row layout reads.
