# Align the diff split, add per-pane horizontal scrollbars, and show a loading state

## Goal

Fix the three diff regressions: the fixed file-name divider must line up with the pane split, each pane must have its own working horizontal scrollbar owned by `VirtualScroll`, and the page must show an in-progress state instead of flashing `No differences` before the first document arrives.

## Requirements

- **R1 Split alignment.** The divider in the fixed file-name strip and the left/right pane split use the same x position and the same 3px width.
- **R2 Per-pane horizontal scroll.** Each docs view pane has its own horizontal scrollbar. Each bar scrolls only that pane's content. `VirtualScroll` owns the bars, the offsets and the scroll wiring; the docs view remains a window renderer.
- **R3 Loading state.** Until the first `document` message arrives, the diff page shows an in-progress state (`Loading comparison…`, `aria-busy`) and never `No differences`.
- **R4 Compatibility.** Vertical scrolling, shared row offsets, fixed file names, header rows, search, swap, selection, Context and semantic/strict mode keep working.

## Acceptance criteria

- **AC1** The title-strip divider and pane split start at the same x and are both 3px.
- **AC2** In the diff, each pane has its own horizontal bar; scrolling one bar moves only that pane and leaves the other offset unchanged.
- **AC3** The docs view has one full-width horizontal bar.
- **AC4** The initial diff DOM shows `Loading comparison…` with `aria-busy="true"`, not `No differences`; the first document clears the busy state.
- **AC5** Existing tests plus the new alignment, per-pane scroll and loading tests pass; benchmark, package and VSIX stay green.
