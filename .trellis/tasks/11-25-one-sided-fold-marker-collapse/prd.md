# Fix one-sided folded containers and Collapse All

## Goal

Only mark collapsed containers that exist on both sides, and make Collapse All fold removed/added containers on the side that owns them instead of the other pane unfolding them.

## Requirements

- A collapsed row that exists on only one side never gets the hidden-difference marker, even when its subtree contains added/removed rows.
- A collapsed row that exists on both sides is marked only when its subtree has a substantive difference; a name-only rename of the collapsed row itself does not mark it.
- Fold synchronization only compares row keys present on both sides. A target-only collapsed row must not be unfolded by the pane that lacks it.
- Collapse All folds a left-only or right-only container on its owning pane and keeps it folded.
- A newer fold/unfold action wins over older queued sync events.
- Existing copy, sticky, marker and gap behavior stays unchanged.

## Acceptance criteria

- [ ] Unit tests cover a one-sided root, a shared root with a one-sided descendant, a name-only root and a substantive root.
- [ ] `foldTogglePlan` skips a target-only key instead of toggling it.
- [ ] `diff-collapse-all` shows the one-sided module and shared module headers with children hidden.
- [ ] `diff-collapsed`/`diff-collapsed-onesided` still pass.
- [ ] Full preview set, types, lint, tests, fallow and production bundle pass.

## Non-goals

- Hiding the native gap for a top-level one-sided module with no shared ancestor.
- Changing copy semantics or the marker count design.
- Persisting fold state.
