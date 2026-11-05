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
    offsets: readonly number[];   // length rowCount + 1
    renderRow(index: number, pane: string): HTMLElement;
    contentWidth?: number;
}
interface DocumentTreeViewCallbacks {
    onRender?(range: [number, number]): void;
    onRowClick?(index: number, event: MouseEvent): void;
}
class DocumentTreeView {
    constructor(root: Element | string, pane: string, callbacks?: DocumentTreeViewCallbacks);
    mount(): void;
    setModel(model: DocumentTreeViewModel): void;
    setContentWidth(width: number): void;
    render(viewport: DocumentTreeViewport, force?: boolean): void;
    getVisibleRange(): [number, number];
    getWindowElement(): HTMLElement;
    elementAt(index: number): HTMLElement | undefined;
}
```

## Rules

- Owns an absolutely positioned `.document-tree-window` inside a pane layer. The window is placed at `offsets[start]`, sized to the rendered slice and translated by the shared horizontal offset. It never creates a scroller, a pinned header, a spacer or a title bar.
- `VirtualScroll` owns the scroll surface and the precomputed offsets; this component receives only the viewport and renders the visible slice plus overscan.
- Header rows are ordinary indices in the model. The host decides their markup, search haystack and interaction; the component only calls `renderRow`.
- A render whose range, total height, viewport and revision are unchanged does no DOM work. Incremental edge updates keep the rendered window bounded.
- Host supplies rows and status; the editor never supplies a diff status. Root-scoped; two instances coexist without id collisions.
- No scroll or size math in this component beyond choosing the visible slice from the supplied offsets.

## Behaviour

- Annotation, node, brace and header rows in display order; the Document host sets the module gap on the first row. The diff host sets no gap.
- Header rows use the document row shell: same height, content padding, hover/focus and token styling, no twisty and no ECUC selection.
- Guides nested by ancestor level; closing brace rows carry ancestors only.
- Status tint is a diff-only render input applied by the host callback.
- Node, brace and comment rows inside a selected subtree carry `data-subtree`; the selected row itself uses selection state.
- A comment node carries `rowId` for hover/guide lookups and `data-subtree` when its owning row is inside the selection; it stays `aria-hidden`, has no tab stop and a click does nothing.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty model | The window clears and reports `[0, 0]` |
| Large model | Rendered DOM bounded by viewport + overscan |
| Header present | Header rows are content and scroll; they never pin and never change ECUC selection |
| Two instances | Independent windows, one shared VirtualScroll in the diff |

## Tests Required

`src/test/webview/components/documentTree.test.ts`: window position at the first offset, rendered slice,
horizontal translation, render-key skip, click index, empty model and the absolute-window stylesheet.

`src/test/webview/components/virtualScroll.test.ts`: content height, visible range, vertical/horizontal
setters, row scroll-to and one coalesced frame.

`src/test/webview/page/render.test.ts`: selecting a container highlights a descendant sub-container's
annotation row, clicking an annotation does not change the selection, and node/brace/comment rows carry
`data-subtree` only inside the selected subtree; header rows are content.

## Anti-patterns

- Component reading editor/diff host state or posting messages.
- Host writing row DOM directly instead of supplying `renderRow` output.
- Full-list render or per-row layout reads.
