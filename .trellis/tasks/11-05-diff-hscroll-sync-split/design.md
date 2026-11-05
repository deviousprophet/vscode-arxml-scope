# Design — synced horizontal bars and split alignment

## 1. Horizontal sync

`VirtualScrollCallbacks` gains `syncHorizontal`. When true (diff only), a horizontal bar's `scroll` event copies its `scrollLeft` to every other bar before scheduling the viewport repaint. Setting an already-equal bar is skipped, so the mirror cannot bounce. The docs view leaves the flag off.

The two diff bars remain independent DOM scrollbars; only their offsets are mirrored. Each pane still renders with `getViewportFor(pane).left`, and `DocumentTreeView` includes `viewport.left` in its render key.

## 2. Title/pane alignment

The pane split is at 50% of `.virtual-scroll-content`, whose width is the vertical scroller's client width (the scrollbar gutter is excluded). The title strip spans the full `#diff-body` width, so its 50% divider was offset by half the gutter.

`DiffView.syncScrollbarWidth()` measures `scroll.offsetWidth - scroll.clientWidth` and writes `--diff-scrollbar-width` on `#diff-body`. `.diff-title-strip` uses `width: calc(100% - var(--diff-scrollbar-width, 0px))`; `.virtual-scroll-hbars` uses the same width. The 3px divider and the pane border then share the same x origin.

## 3. Verification

- `virtualScroll.test.ts`: sync flag mirrors both bars; gutter width.
- `diffView.test.ts`: title width variable and CSS calc; mount still one surface.
- `diffPage.test.ts`: either bar moves both panes.
- Full suite, benchmark, package, VSIX.
