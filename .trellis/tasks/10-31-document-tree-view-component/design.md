# Design: DocumentTreeView component (Hex Scope pattern)

## Component boundary

New `src/editor/documentTreeView.ts` (serialized into both pages) owns layout and virtual scrolling; hosts own data.

```ts
interface DocumentTreeViewCallbacks {
	onVisibleWindowChange?(top: number, left: number): void;
	onRowClick?(index: number, event: MouseEvent): void;
}

interface DocumentTreeViewModel {
	rowCount: number;
	heightFn(index: number): number;
	/** Build the row for this pane; the host decides node/brace/comment/status. */
	renderRow(index: number, pane: string): HTMLElement;
}

class DocumentTreeView {
	constructor(rootSelector: string, pane: string, callbacks: DocumentTreeViewCallbacks);
	mount(): void;
	setModel(model: DocumentTreeViewModel): void;
	render(force?: boolean): void;
	setScrollTop(top: number): void;
	getScrollTop(): number;
	setScrollLeft(left: number): void;
	getScrollLeft(): number;
	clientHeight(): number;
	clientWidth(): number;
}
```

- The component creates `root > header + scroll > spacers + window`.
- `render()` uses the shared virtual-scroll math, one height per display row, overscan 10, top/bottom spacers, and skips the DOM write when the window/key is unchanged.
- It handles `scroll` (rAF), `wheel` (Shift+wheel → `scrollLeft`), and forwards the new top/left.
- Documents styles and variables live in the component (`documentTreeStyles()`); the editor and diff inject that one string.
- `renderRow` is host-supplied: the editor builds a single-pane Document row; the diff builds the two-cell diff row with optional status. The shared `documentRows.ts` builders are used inside both.

## Editor migration

- Replace the page-local `#main`/`#tree` virtual window plumbing with one `DocumentTreeView` instance mounted at `#tree-root`.
- Keep the existing toolbar, sidebar, Details, search, collapse and selection state.
- Host callbacks:
  - `renderRow(index)` → existing `buildDisplayRow` (now using shared builders).
  - row click → existing select/twisty path.
  - visible window → existing search/reveal helpers.
- `heightFn`, `carryGroupGap`, fold/collapse and scroll-position restore stay host concerns passed into the model.

## Diff migration

- Diff body becomes a 50/50 grid of two `DocumentTreeView` instances:
  - left root and right root, each with its own native vertical and horizontal scrollbar.
  - No proxy bars, no fixed-height scrollbar strip.
- Both components receive the same aligned `DiffDisplayRow` list and `heightFn`; `renderRow(index, pane)` builds a `.diff-row` with two cells, using that pane's node/brace/comment and the optional status.
- Header (file label + schema/packages) is set through `setHeader`/render input for each pane.
- Optional status is a component input used only by the diff renderer.

## Scroll sync

Mirror Hex Scope's host sync:

- Each pane has a `VirtualScrollState`; the component reports `onVisibleWindowChange`.
- The pane that scrolled becomes the driver. Host copies the driver's logical `scrollTop` to the follower and calls `follower.setScrollTop`. A suppressed-scroll guard prevents feedback loops.
- Horizontal: host copies `scrollLeft` to both components immediately.
- One rAF coalesces render requests; the follower renders only when its visible slice key changes.
- Shift+wheel is handled by the component and reported like a native horizontal scroll.
- Swap resets both `scrollLeft` values; vertical `scrollTop` is preserved.

## Scrollbar sizing

- Both axes are native scroller overflow; no fixed `height` on the bar container.
- The component scroller uses `overflow: auto` and `scrollbar-gutter: stable` so the native bar gets its full height and never clips.

## Performance

- Window render is O(visible rows); overscan is a fixed constant.
- Render key includes `start`, `end`, total height, container size and row-height version; unchanged slices skip DOM work.
- Scrolling does one rAF render per frame per pane; no per-row layout reads.
- 10k-row test asserts rendered `.node` count stays bounded and a full scroll does not touch every row.

## Risks

- Editor migration must preserve all current keyboard/search/details behaviour; gate on existing editor tests plus a byte-identical style comparison.
- Diff sync must not fight native scroll events; use suppressed-scroll guards and rAF.
- Two independent scrollers double the DOM window, but each is capped by viewport + overscan.

## Rollback

Revert the task commit. Editor returns to its inline virtual plumbing; diff returns to the single shared window. No payload/state changes.
