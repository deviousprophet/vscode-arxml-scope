# Diff toolbar grouping and scroll behavior

## Goal

Make the diff toolbar match the requested Beyond Compare grouping, keep each pane's file header pinned
above the rows, and remove the header-sized dead zone that makes wheel scrolling slow at the top and
vertical scrollbar dragging track poorly.

## Requirements

- **R1 Label.** Rename **Show diff only** to **Show diff** in the visible label, `title` and
  `aria-label`.
- **R2 Toolbar order.** The left group is `Show all / Show diff`, divider, `Context`, divider,
  `Semantic / Strict`, divider, `Prev diff / Next diff`. **Swap sides** is a separate centered control
  aligned with the left/right pane split. Search and the mode status stay on the right.
- **R3 Dividers.** Each divider is a vertical rule between the groups, not a wrapping border.
- **R4 Pinned header.** The pane's file name, schema and package lines stay above the scrolling rows;
  they are not part of the scroll content.
- **R5 Top scroll speed.** One wheel notch moves the same number of rows at the top, middle and bottom.
- **R6 Drag tracking.** Holding and dragging the vertical scrollbar keeps the diff rows under the
  cursor without a header-sized offset or jump.
- **R7 Compatibility.** The editor uses the same `DocumentTreeView`; its header is pinned too. Row
  virtualization, selection, search, swap, context and the mode cache stay intact.
- **R8 Tests.** Toolbar order/dividers/label, header placement, row-offset math and scroll mapping are
  covered.

## Acceptance criteria

- **AC1** The toolbar reads exactly `Show all | Show diff ÷ Context ÷ Semantic | Strict ÷ Prev diff |
  Next diff`, with Swap centered over the pane divider and Search/status on the right.
- **AC2** The file name/schema block remains visible while the rows scroll.
- **AC3** Scrolling from offset zero moves rows immediately; no header-height dead zone.
- **AC4** Dragging the left vertical scrollbar tracks the cursor linearly through the rows.
- **AC5** The editor still renders and virtualizes correctly after the shared header change.
- **AC6** Existing tests plus the new toolbar/document-tree tests pass; package and VSIX listing stay
  green.
