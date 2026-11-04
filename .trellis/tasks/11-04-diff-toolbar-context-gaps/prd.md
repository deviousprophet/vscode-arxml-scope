# Diff toolbar redesign, row polish and context gaps

## Goal

Make the diff view easier to scan and navigate: a Beyond Compare-style toolbar, consistent
added/removed row edges, no visible diff counts, renamed rows that look like ordinary changes, and
expandable split lines with five lines of context around each change.

## Requirements

- **R1 Toolbar layout.** Every diff toolbar button uses a large icon above a smaller label. The
  toolbar grows to fit; the panes lose that height. Labels hide only at narrow widths, while
  `title`/`aria-label` remain.
- **R2 View groups.** `Show all` / `Show diff only` and `Semantic` / `Strict` are two mutually
  exclusive view groups. `Context` is the only standalone on/off toggle.
- **R3 No counts.** Remove the visible changed / added / removed / renamed summary. The summary stays
  in the model for logic and tests.
- **R4 Context.** `Context` is active by default and fixed at 5 unchanged rows above and below each
  change. It has no menu and no other values. It is disabled while `Show all` is active.
- **R5 Renamed rows.** Remove the `renamed` badge and the dashed rename-implied underline. A renamed
  container renders exactly like a normal changed row.
- **R6 Added edge.** Added rows get a 3px solid leading-edge bar on the right cell, matching the
  removed row's leading-edge bar. Remove the trailing-edge variant.
- **R7 Split lines.** In `Show diff only`, each hidden run becomes one expandable split row showing
  `N unchanged lines`. Clicking expands the hidden rows; the header remains so they can be collapsed.
  The control sits in the displayed left pane and follows `Swap sides`.
- **R8 Navigation.** Split rows are not tree nodes: selection, `F7` and search skip them. The expand
  control is keyboard-focusable and exposes `aria-expanded`.
- **R9 State.** Expanded gaps survive view switches within the same document and reset on a new
  document. Selection and scroll survive toggling a gap.
- **R10 Compatibility.** The diff stays read-only; no new dependency; semantic/strict output and the
  prepared-document cache stay unchanged.

## Acceptance criteria

- **AC1** All diff toolbar buttons show an icon with a label underneath; the toolbar does not wrap.
- **AC2** Semantic/Strict is a two-button group; Context is a default-active toggle with fixed 5+5
  lines and is disabled in Show all.
- **AC3** No changed/added/removed/renamed count is visible anywhere in the diff page.
- **AC4** A renamed container has no badge, no dashed underline, and the normal changed background
  and edge.
- **AC5** Added rows show a bold leading edge; changed and removed rows keep their current edges.
- **AC6** Split rows appear between hidden runs, expand/collapse, and are skipped by selection, F7 and
  search.
- **AC7** Context 5 shows five unchanged rows above and below each change; context off shows none.
- **AC8** Existing diff output is unchanged; all prior tests plus the new core/page tests pass.
