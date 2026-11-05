# Sync diff horizontal bars and align the split

## Goal

Make the diff panes' horizontal bars move together, and make the fixed title strip's divider line up with the pane split after the vertical scrollbar gutter is accounted for.

## Requirements

- **R1 Synced horizontal bars.** In the diff view, moving either pane's horizontal bar copies that offset to the other pane; both pane contents move together. The docs view keeps its single bar.
- **R2 Split alignment.** The 3px divider in the fixed title strip and the 3px left/right pane split use the same x position. The title strip width excludes the vertical scrollbar gutter.
- **R3 Compatibility.** Vertical scrolling, precomputed offsets, header rows, search, selection, swap, Context and mode switching stay intact.

## Acceptance criteria

- **AC1** Dragging or scrolling either diff horizontal bar moves both panes to the same horizontal offset.
- **AC2** The title divider and pane split share the same x position and width, including when the vertical scrollbar is present.
- **AC3** The docs view still has one full-width horizontal bar.
- **AC4** Existing tests plus the new sync/alignment tests pass; benchmark, package and VSIX stay green.
