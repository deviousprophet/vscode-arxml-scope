# Component Spec — VirtualScroll

## Scope / Trigger

Owns `src/webview/components/virtualScroll/` (`virtualScroll.ts`, `virtualScroll.css`): the shared
scroll surface, both scrollbars, the precomputed row offsets and the visible range. The Document window
renderers supply content; the host owns the row model and the selection/search state.

Boundary rule: the component never reads host globals or posts provider messages. It reports the
viewport through one callback.

## Layout

```text
src/webview/components/virtualScroll/
    virtualScroll.ts       scroll surface + offsets + callbacks
    virtualScroll.css      surface, pane layers and horizontal bar
src/webview/editorViewer.ts / diffViewer.ts   composition roots
src/test/webview/components/virtualScroll.test.ts
```

## Contract

```typescript
interface VirtualScrollContent {
    rowCount: number;
    offsets: readonly number[];   // length rowCount + 1
    totalHeight: number;
    contentWidth: number;
}
interface VirtualScrollViewport {
    top: number;
    left: number;
    height: number;
    width: number;
}
interface VirtualScrollCallbacks {
    onViewportChange?(viewport: VirtualScrollViewport): void;
}
class VirtualScroll {
    constructor(rootSelector: string, panes: readonly VirtualScrollPane[], callbacks?: VirtualScrollCallbacks);
    mount(): void;
    setContent(content: VirtualScrollContent): void;
    setContentWidth(width: number): void;
    getContentElement(): HTMLElement;
    getPane(index: number): HTMLElement | undefined;
    getViewport(): VirtualScrollViewport;
    getVisibleRange(): [number, number];
    setScrollTop(top: number, defer?: boolean): void;
    setScrollLeft(left: number, defer?: boolean): void;
    getScrollTop(): number;
    getScrollLeft(): number;
    clientHeight(): number;
    clientWidth(): number;
    scrollToIndex(index: number, align?: 'auto' | 'start' | 'end'): void;
    render(): void;
    destroy(): void;
}
```

## Rules

- Owns one vertical native scroller with a tall content element, one horizontal scrollbar and one pane
  layer per pane. In the diff, the pane split stays fixed and both pane contents use the shared
  horizontal offset.
- `offsets` is the single geometry source, including header rows and variable heights. The visible
  range is a binary search; a scroll frame never walks row heights.
- `setContent` updates `totalHeight`/`contentWidth`; the content element's height and the horizontal
  spacer's width make the native thumb and drag exact.
- Emits one viewport callback per animation frame. The renderer owns row DOM; VirtualScroll never
  writes a row.
- `setScrollTop`/`setScrollLeft` are the programmatic entry points. Native wheel/bar movement stays on
  the same path.
- Root-scoped; the editor mounts one pane, the diff mounts two.

## Behaviour

- One vertical bar and one horizontal bar for the whole surface.
- Header rows and content rows share the same offsets; scrolling them out is ordinary content movement.
- Dragging the vertical thumb maps linearly to the offsets, including variable-height rows.
- A resize or content change recomputes the range; the current scroll offset is preserved unless the
  browser clamps it.
- `Shift+wheel` or a horizontal trackpad gesture moves the shared horizontal offset.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty content | Zero height, hidden horizontal bar, range `[0, 0]` |
| One row | Thumb spans the content; range `[0, 1]` |
| Variable heights | Binary search lands the row containing the scroll offset |
| Two panes | One offsets table; both panes render the same range |
| Programmatic scroll | One viewport callback on the next frame |

## Tests Required

`src/test/webview/components/virtualScroll.test.ts`: mount, content height, visible range, scroll
setters, row scroll-to, one coalesced frame, content-width growth.
`src/test/webview/components/diffView.test.ts`: one surface, two panes, fixed title outside.
`src/test/webview/page/render.test.ts` / `diffPage.test.ts`: the docs/diff content windows follow the
shared viewport.

## Anti-patterns

- A pane owning its own vertical scroller.
- Rendering all rows to fake the scroll height.
- Recomputing cumulative heights inside a scroll handler.
- Moving the pane split with the horizontal offset.
