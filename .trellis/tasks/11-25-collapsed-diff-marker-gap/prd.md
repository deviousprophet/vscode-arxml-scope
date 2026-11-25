# Fix collapsed diff marker semantics and diagonal fill gap

## Goal

Make the collapsed-container marker mean “hidden content differs”, ignore a rename of the collapsed row itself, align the dot to the row, and remove the striped diagonal-fill gap that remains inside a folded diff region.

## Requirements

- A collapsed row is marked only when its folded subtree has a substantive difference.
- A name-only change on the collapsed row itself does not mark it.
- A changed, added or removed descendant still marks the collapsed row.
- The marker is vertically centred on the line and remains a small glyph-margin dot with no text or count.
- A one-sided added/removed row inside a shared collapsed container must not leave a `diagonal-fill` view zone visible inside the fold.
- Expanded one-sided hunks keep their native diagonal fill.
- The fix is a scoped patch to the pinned Monaco package, not a global CSS hide.
- Fold synchronization, copy actions, sticky headers and fold ranges stay unchanged.

## Acceptance criteria

- [x] Unit tests cover name-only root, substantive root, name-only descendant and added/removed descendant.
- [x] `diff-collapsed` still shows the dot; a new one-sided collapsed state shows no visible `.diagonal-fill` inside the fold.
- [x] The marker dot is centred in the glyph margin.
- [x] `patches/monaco-editor+0.57.0.patch` contains only the intended extra view-zone change.
- [x] The pinned hash contract includes `diffEditorViewZones.js`.
- [x] Full preview set, types, lint, tests, fallow and production bundle pass.

## Non-goals

- Hiding all diagonal fills globally.
- Changing the diff algorithm or one-sided copy semantics.
- Counting hidden changes or adding text to the marker.
- Updating Monaco beyond 0.57.0.
