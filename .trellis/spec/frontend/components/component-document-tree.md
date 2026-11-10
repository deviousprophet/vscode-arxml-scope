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
interface DocumentTreeLineInfo {
    number?: number;
    status?: 'changed' | 'added' | 'removed' | 'unchanged';
}
interface DocumentTreeViewModel {
    rowCount: number;
    offsets: readonly number[];   // length rowCount + 1
    renderRow(index: number, pane: string): HTMLElement;
    contentWidth?: number;
    lineInfo?(index: number, pane: string): DocumentTreeLineInfo | undefined;
    activeLine?(pane: string): number | undefined;
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
    lineNumberChars(): number;
    refreshActiveLine(): void;
}
```

## Rules

- Owns an absolutely positioned `.document-tree-window` inside a pane layer. The window is placed at `offsets[start]`, sized to the rendered slice and translated by the shared horizontal offset. It never creates a scroller, a pinned header, a spacer or a title bar. Its `min-width` is `max(100%, var(--document-tree-content-width, 0px))`, so it is never narrower than the pane or the full host-estimated content width; the selection/subtree fill therefore keeps a stable width while the rendered slice changes.
- `setContentWidth` is monotonic within one model: a later measurement may raise the minimum but never lower it. `setModel` resets the floor to the model's full-document `contentWidth` (a narrower new document can lower it); the host publishes that estimate, not the visible slice.
- Owns the `.document-tree-lines` gutter as a sibling after the window. It is absolutely positioned, full pane height, `aria-hidden`, non-focusable and never translated, so horizontal panning leaves it fixed while the window scrolls underneath. Cells are `.document-tree-line-number` elements placed with CSSOM `top`/`height` from the same offsets and the same `[start, end)` slice as the window.
- The host supplies `lineInfo(index, pane)` for the number and the diff tint; `undefined` or `{ number: undefined }` leaves the cell blank. `lineInfo` is the single source for both facts.
- `lineNumberChars()` is cached in `setModel`: `max(digits(max number), 5)`, or `0` for an empty model. `setModel` writes `--line-numbers-width: <chars>ch` on the pane; the `.document-tree-pane` rule redeclares `--content-pad` from that width so row padding, guides and depth follow it. The gutter is a `ch`-wide column; the component CSS owns the right alignment, tabular digits, `cursor: default`, `user-select: none` and the editor line-number colours.
- `activeLine(pane)` is read on every paint and on `refreshActiveLine()`, which re-applies `data-active` without rebuilding. Only a numbered cell can be active; a blank missing-side cell never is.
- The Document gutter repeats the row's 2px selection rail on an active cell, and its 2px focus rail on a focused `.node` row, because the opaque gutter covers the row's leading edge. The component tracks node focus with `focusin`/`focusout`; headers and gaps never get a gutter rail.
- Clicking a gutter cell calls `this.elementAt(index)?.click()`, so the host's existing row click selects/focuses exactly like clicking the row. Header and gap rows keep their own no-op/ focus behaviour.
- `VirtualScroll` owns the scroll surface and the precomputed offsets; this component receives only the viewport and renders the visible slice plus overscan.
- Header rows are ordinary indices in the model. The host decides their markup, search haystack and interaction; the component only calls `renderRow`.
- A header gap row is also an ordinary, host-rendered index. It is `role="presentation"`, `aria-hidden`, non-focusable and has no node key; it participates in the row count, offsets and line numbers but never in search or selection. It is one blank row at `--ecuc-lh` with no rule child or border.
- A module gap row uses the same ordinary-index model. `.document-tree-header-gap` and `.document-tree-module-gap` share one blank-row rule (`height: var(--ecuc-lh)`, content padding, flex centring); neither has a border, rule or gradient.
- A render whose range, total height, viewport and revision are unchanged does no DOM work; the active number is still refreshed. Incremental edge updates keep the rendered window bounded.
- Host supplies rows and status; the editor never supplies a diff status. Root-scoped; two instances coexist without id collisions.
- No scroll or size math in this component beyond choosing the visible slice from the supplied offsets.

## Behaviour

- Annotation, node, brace and header rows in display order. When `flattenRows` is called with `moduleGaps: true`, one `{ type: 'module-gap', level: 1 }` display row is emitted before every module after the first, above its annotations. The Document host sets the option; the diff host builds its own shared gap in `flattenDiffDocument`.
- Every virtual row is a line: header rows, the blank header gap, the blank module gap, annotation/comment rows, braces and nodes are numbered from 1. Collapsing a subtree removes its rows and renumbers the remaining lines.
- The Document host returns `{ number: index + 1 }` for every row. The diff host numbers each pane's own display lines and returns the displayed status for node rows.
- When a header exists, one `.document-tree-header-gap` / `.diff-header-gap-row` blank row follows the last header and precedes the first module. It uses the standard row height and is numbered on both sides in the diff; no rule, border or separator treatment.
- A module gap is `role="presentation"`, `aria-hidden`, `tabIndex=-1`, has no node/header identity and stays out of every id/key map, search candidate list and navigation target. Clicking the row or its number changes nothing. The first module has no gap.
- Header rows use the document row shell: same height, content padding, hover/focus and token styling, no twisty and no ECUC selection.
- Guides nested by ancestor level; closing brace rows carry ancestors only.
- Status tint is a diff-only render input applied by the host callback.
- Node, brace and comment rows inside a selected subtree carry `data-subtree`; the selected row itself uses selection state.
- A comment node carries `rowId` for hover/guide lookups and `data-subtree` when its owning row is inside the selection; it stays `aria-hidden`, has no tab stop and a click does nothing.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty model | The window and gutter clear, the range is `[0, 0)` and `lineNumberChars()` is `0` |
| Large model | Rendered DOM (rows and gutter cells) bounded by viewport + overscan |
| Header present | Header rows are content and scroll; they are numbered and never change ECUC selection |
| Header gap | One inert blank line after the last header, numbered in the Document and both diff panes; absent when no header exists; no rule or border |
| Module gap | One inert blank numbered line before every module after the first; no rule, border, tint, focus, selection, search or F7; the first module has none |
| Short selected row | The window spans the pane and the full content width, so the selection/subtree fill does not shrink to the rendered slice |
| Missing diff side | That pane's gutter cell is blank and cannot be active |
| Two instances | Independent windows and gutters, one shared VirtualScroll in the diff |

## Tests Required

`src/test/webview/components/documentTree.test.ts`: window position at the first offset, rendered slice,
horizontal translation, render-key skip, click index, empty model, the absolute-window/no-rule stylesheet,
the `max(100%, content width)` minimum and its monotonic growth, gutter mount/range, cell positions from
the offsets, digit width (5 minimum and growth), empty-model collapse, active refresh, focus-rail
refresh, click forwarding and the gutter CSS.

`src/test/webview/components/virtualScroll.test.ts`: content height, visible range, vertical/horizontal
setters, row scroll-to and one coalesced frame.

`src/test/webview/page/render.test.ts`: selecting a container highlights a descendant sub-container's
annotation row, clicking an annotation does not change the selection, and node/brace/comment rows carry
`data-subtree` only inside the selected subtree; header rows are content and the header gap is inert;
the module gap is one numbered blank row between module groups, with no `data-gap`, extra height, node
identity, selection, focus, search or number action, and it renumbers after collapse/expand; numbers
start at 1 and include the header and blank gaps, the selected row
is active and cleared by a re-scan, the gutter stays fixed under horizontal scroll and follows vertical
scroll, and clicking a number selects the row while a header/gap number selects nothing. The full
content width comes from the model (header lines, comments and the module prefix included), not the
rendered slice.

`src/test/webview/page/diffPage.test.ts`: the header gap is one blank numbered line in both panes when a
header exists, absent when it does not, and never receives selection or focus; the shared module gap is
the same virtual row in both panes, numbered on both sides, with no key/status/cell, and absent before
the first visible module or a module hidden by Show diff/Context; each pane numbers its own
lines with blank padded/missing sides, hidden runs unnumbered, renumbering after Show diff/Context/swap/
collapse, the active number and a fixed horizontal gutter; the diff content width includes header lines.

## Anti-patterns

- Component reading editor/diff host state or posting messages.
- Host writing row DOM directly instead of supplying `renderRow` output.
- Full-list render or per-row layout reads.
- Rendering gutter cells outside the window's `[start, end)` slice, translating the gutter with the window, or rebuilding it on every unchanged viewport.
- Sizing the number column from a measured pixel width instead of the cached character count, or letting an empty model keep a visible gutter.
