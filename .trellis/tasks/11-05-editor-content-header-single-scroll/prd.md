# Schema/package content rows and one diff vertical scroll

## Goal

Make the schema/package lines part of the ARXML document content in both the docs view and the diff view: they scroll with the document, use the same row and search machinery, and are no longer a pinned strip. A separate `VirtualScroll` component owns the scroll surface, and the diff uses one shared scroll geometry for both panes instead of two independent vertical scrollers.

## Requirements

- **R1 Header content.** Schema/package lines are first-class rows in the virtual content list in both views. No pinned schema/package block remains.
- **R2 Row behaviour.** Header rows use the same document row shell, height and render path as document rows, are searchable, and may receive click/keyboard focus. They never post an ECUC selection or change Details.
- **R3 Virtual geometry.** The docs view reports precomputed cumulative offsets and total height, including header rows and module gaps. Scroll frames use those offsets and only render the visible window.
- **R4 One shared scroll surface.** A separate `VirtualScroll` component owns both axes. The docs view is its content. In the diff, one shared geometry drives both panes, with one vertical and one horizontal scrollbar; the pane split stays fixed while both pane contents pan together.
- **R5 Fixed diff identity.** The diff file-name strip sits outside `VirtualScroll` and never scrolls. The docs view has no file-name strip.
- **R6 Header alignment.** Both diff panes pad their schema/package rows to the same count so the first compared row starts at the same y.
- **R7 Compatibility.** Selection, search, collapse, Context, semantic/strict mode, reveal and the virtual window keep working.

## Acceptance criteria

- **AC1** The schema/package lines scroll out of view with the first rows in both the docs and diff views.
- **AC2** A search matches a schema/package line and jumps to it; in the diff, one aligned header row is one search candidate.
- **AC3** Clicking or focusing a header row does not change the ECUC selection or Details.
- **AC4** The diff has one `VirtualScroll` surface with one vertical and one horizontal scrollbar; both panes stay row-aligned and the pane split does not move horizontally.
- **AC5** Content height and offsets are computed before scrolling; a scroll frame only renders the visible window.
- **AC6** The diff file name stays fixed outside the scroll surface; the docs view has no file name.
- **AC7** A shorter diff header is padded with blank, non-searchable rows so the first compared row aligns.
- **AC8** Existing tests, package and VSIX checks stay green.
