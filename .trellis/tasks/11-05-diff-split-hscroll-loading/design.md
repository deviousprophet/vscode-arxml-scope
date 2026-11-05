# Design — split alignment, per-pane horizontal bars, diff loading

## 1. Title divider alignment

`diffView.css`:

- `.diff-title-strip` becomes `position: relative; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)`.
- Remove `.diff-title-cell + .diff-title-cell { border-left: ... }`.
- Add `.diff-title-strip::after` with `left: 50%; top: 0; bottom: 0; width: 3px;` and the same divider colour. The right pane uses `left: 50%; border-left: 3px`, so both left edges are at 50% and both are 3px wide.

## 2. Per-pane horizontal bars in VirtualScroll

`virtualScroll.ts` / `.css`:

- DOM:
  ```text
  virtual-scroll
    virtual-scroll-vscroll
      virtual-scroll-content
        pane 0 layer
        pane 1 layer
    virtual-scroll-hbars
      virtual-scroll-hscroll[data-pane="0"]
        virtual-scroll-hspacer
      virtual-scroll-hscroll[data-pane="1"]
        virtual-scroll-hspacer
  ```
- The hbars row is positioned relative. With two panes, bar 0 is `left: 0; width: 50%` and bar 1 is `left: calc(50% + 3px); right: 0`, matching the pane content tracks. With one pane, the single bar spans the full width.
- `VirtualScrollContent` gains optional `contentWidths: readonly number[]`. Each bar's spacer uses its width; `contentWidth` remains the fallback for one value.
- Add `horizontalOffsets: number[]`; `setScrollLeft(left, paneIndex = 0)`, `getScrollLeft(paneIndex = 0)`, `getHorizontalBar(index)`, `getViewportFor(paneIndex)`.
- Each bar's native `scroll` event updates only its own offset and schedules one viewport callback. `onWheel` selects the pane from `event.target.closest('.virtual-scroll-pane')` and moves that bar.
- The pane window is translated by its own offset; the vertical surface and row offsets stay shared.
- Keep `hscroll`/`hspacer` as aliases for pane 0 for existing callers/tests.
- The window render key includes `viewport.left`, so a horizontal-only scroll actually repaints the window; without it the row range is unchanged and the transform is skipped.

## 3. DiffView wiring

- `DiffView.render` obtains `getViewportFor(0)` and `getViewportFor(1)` and passes each to its `DocumentTreeView`.
- `setContent` forwards `contentWidths`; `setContentWidth` can stay as a shared fallback.
- `resetHorizontal` zeroes both offsets.
- The fixed title strip and vertical scroll are unchanged.

## 4. Diff loading state

`diffViewer.ts`:

- Add `loaded = false`; reset it in `resetDiffState`.
- `updateEmptyState`:
  - before the first document: show `#diff-empty` with `Loading comparison…`, `data-busy="true"`, `aria-busy="true"`; hide the list.
  - after the first document: clear busy, then show the existing empty/`No differences` or the list.
- `setDocument` sets `loaded = true` after validating the payload.
- CSS adds a small busy spinner/ellipsis using theme tokens; no new data.

## 5. Tests

- CPU-level: `virtualScroll.test.ts` with two panes, two bars, independent offsets and per-pane viewports.
- Diff component: two horizontal bars exist; title divider CSS is aligned; fixed title remains outside.
- Diff page: initial load shows the busy state; posting a document clears it; scrolling bar 0 changes only pane 0.
- Docs page: one horizontal bar remains.
- Red-check the title divider, per-pane offset and loading state.

## 6. Rollback

Revert the hbars DOM/API and return to the single horizontal proxy; restore the title-cell border and remove the loading flag. No persisted state.
