# Fix diff Prev/Next navigation

## Goal

Make `Prev diff` and `Next diff` move to the adjacent change every time, wrap at the ends and reveal the correct model line, including after Swap.

## Requirements

- Next advances to the first change strictly after the current displayed line, otherwise wraps to the first.
- Prev moves to the last change strictly before the current displayed line, otherwise wraps to the last.
- The current line is read from the editor pane that is actually displayed under Swap.
- Reveal sets the position on the displayed change line in both diff editors so the synchronized scroll lands on the change.
- An empty change list keeps the existing notice.
- No change to the diff algorithm, hunk search or host.

## Acceptance criteria

- [ ] Starting before the first change, Next visits every change in order.
- [ ] Another Next after the last wraps to the first.
- [ ] Prev visits the same sequence backward and wraps to the last.
- [ ] The same sequence works with Swap enabled.
- [ ] A pure unit test covers forward/backward and wrap without loading Monaco.
- [ ] A preview probe records the position after each click and fails on a repeated line.

## Non-goals

- Changing the change-list algorithm.
- Adding a change counter or new toolbar control.
- Revealing only the overview ruler.
