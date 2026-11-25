# Design — diff Prev/Next navigation

## Root cause

`findForwardChange` compares `changeLine(change) >= current`. After a reveal, `current` equals the selected change line, so Next selects the same change again. `changeLine` also always prefers the modified line, which is the wrong model after Swap.

## Fix shape

Create `src/webview/monaco/diffNavigation.ts` with pure helpers:

- `displayedChangeLine(change, swapped)`: returns the line in the model shown by the modified editor under the current swap state.
- `nextChangeIndex(lines, currentLine)` and `previousChangeIndex(lines, currentLine)` with strict comparisons and wrap.
- `currentChangeIndex(lines, currentLine, direction)` as the shared selector.

`diffMonaco.ts` maps the change list to displayed lines, reads the modified editor's current position, selects the index and reveals both editors:

- modified editor: displayed change line;
- original editor: the corresponding line in the model it currently shows.

The existing `changeLine` fallback for pure insert/delete rows stays, but only for the line number used by that pane.

## Tests

- `src/test/webview/diffNavigation.test.ts`: forward/backward strictness and wrap, with duplicate lines and a single change.
- Preview: add a `diff-nav` scenario that clicks Next through all changes and records the modified line after each click; repeat after Swap; click Prev back.
- Audit fails on a repeated consecutive line or a line outside the expected change set.

## Rollback

Revert the child commit; navigation stays local to the webview.
