# Mark collapsed diff containers that hide differences

## Goal

When a diff container or module is collapsed, a small visual marker tells the user that its folded subtree contains changed, added or removed rows. No count and no text.

## Requirements

- A collapsed row shows a small dot in the glyph margin when its folded subtree contains any row with `status !== 'unchanged'`.
- The dot uses the diff change colour and does not shift the line or add text.
- A collapsed subtree with only unchanged rows shows no dot.
- The marker appears in both panes when the same row is folded, and in the owning pane for a one-sided row.
- Expanding the row, replacing the document or swapping the panes clears stale markers.
- Fold ranges, copy actions, sticky headers and the native diagonal gap stay unchanged.

## Acceptance criteria

- [x] A pure helper detects whether a row subtree contains a non-unchanged row.
- [x] `diff-collapsed` records at least one marker in each pane after folding `Items`.
- [x] The marker is a glyph-margin dot with no count or label text.
- [x] Expanding `Items` removes the markers.
- [x] Full preview set, types, lint, tests, fallow and production bundle pass.

## Non-goals

- Counting hidden changes.
- Replacing the fold hint or adding text.
- Fixing the separate diagonal-fill gap.
- Persisting fold markers.
