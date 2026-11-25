# Design — collapsed marker semantics and view-zone gap

## Marker semantics

`DiffRow.changes` carries the field labels. A container rename is a `changed` row whose changes
are `short name` only. Keep the root row out of the marker when that is true; descendants are
still evaluated normally, so a value change, addition or removal deeper in the subtree marks the
collapsed row.

Define:

- `isNameOnly(row)`: `status === 'changed' && changes.length > 0 && every change.field === 'short name'`.
- `rowHasDifference(row, isRoot)`: unchanged is false; root + name-only is false; otherwise true.
- `subtreeHasDifference(rows, index)`: scan the row and its `subtreeSize` descendants with the root
  flag set only for `index`.

## Dot alignment

The glyph-margin cell is taller than the 6px dot. Centre the dot inside the cell instead of using a
fixed top margin:

```css
.arxml-fold-has-diff { display: flex; align-items: center; justify-content: center; }
.arxml-fold-has-diff::after { width: 6px; height: 6px; margin: 0; }
```

## Diagonal-fill gap

`diffEditorViewZones.js` creates side-by-side filler zones with `createFakeLinesDiv()` and sets
`showInHiddenAreas: true`. `viewZones.js` therefore renders the filler even when its line range is
inside a folded area.

Patch the side-by-side `createFakeLinesDiv()` zones only:

- original-side filler when modified has more lines;
- modified-side filler when original has more lines;
- both synced-moved-text fillers.

Set `showInHiddenAreas: false`. Keep top-padding zones and inline-deleted-code zones unchanged.
The patch must be generated with `patch-package` and pinned by `diffCodeParity.test.ts`.

## Preview proof

Add a fixture where a shared module has a shared `Items` container with `P0000` plus a one-sided
child container. `diff-collapsed-onesided` folds `Items` from both sides and records:

- visible node header and `⋯` hint;
- no visible `P0000`;
- `.diagonal-fill` count in both panes (must be 0 while folded);
- no blank gap before the next visible module.

The existing `diff-collapsed` state keeps the marker regression.

## Rollback

Revert the task commit and regenerate the package patch without the view-zone hunk.
