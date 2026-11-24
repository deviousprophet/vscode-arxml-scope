# Design — modified built-in diff body

## 1. Current gap

`buildAlignedSyntheticDocuments` emits two equal-length synthetic documents. A
row that exists on one side gets a blank placeholder line on the other, so
Monaco never sees a real line-count difference. The page then adds custom
placeholder masks, semantic fills/signs/word spans and glyph-margin arrows.

That makes the body a custom row renderer. It cannot show the built-in diff's
per-side line numbers, diagonal one-sided gaps or center diff margin.

## 2. Per-side synthetic documents

Add `buildDiffSyntheticDocuments(document)`:

```ts
interface DiffSyntheticDocuments {
  left: SyntheticDocument;
  right: SyntheticDocument;
  leftLineKeys: (string | undefined)[];
  rightLineKeys: (string | undefined)[];
}
```

Walk the semantic rows once per side, emitting only that side's content:

- a module gap only on a side that has a module;
- each side's own comment lines;
- the cell line only when that side has a `DiffCell`;
- braces only on the owning side;
- folding ranges per side;
- `rowLine` per side and a `line -> row key` map per line.

The existing `buildSyntheticDocument` remains for the editor page. The aligned
diff builder is removed from the page path (tests move to the per-side builder).

## 3. Body model

`DiffBody` continues to project semantic rows:

- `leftLine` / `rightLine` from the per-side `rowLine`;
- `leftLines` / `rightLines` from the per-side line keys;
- a missing side has no line and no placeholder;
- `owningSides`, `lineOnSide`, `cellOnSide` stay the merge contract;
- `displayLine(row)` returns the owning/displayed line used to anchor the
  center merge control.

No second diff or line-alignment algorithm is introduced.

## 4. Built-in paint

The diff editor owns the body paint:

- `renderIndicators: true` for the native `+`/`-` gutter signs;
- native inserted/deleted line fills and changed-word spans;
- native diagonal fill for one-sided gaps;
- native overview ruler and `hideUnchangedRegions` widgets;
- native per-side line numbers and folding.

Remove the custom body fills/signs/word decorations and the CSS that masks
Monaco's line/char fills. Keep only the ECUC syntax/theme, inherited settings and
the semantic merge/navigation layer. Do not keep the old selection/subtree tint,
the semantic overview-ruler decorations or the custom arrow paint.

## 5. Center merge margin

Monaco's `renderMarginRevertIcon` stays on. The built-in
`arrow-revert-change codicon codicon-arrow-right` view-zone margin is always
mounted and the `arxml-diff-merge` host class gates its visibility, so toggling
Merge never rebuilds the diff view zones. The page captures that click in the
modified editor, maps the view-zone line change to the first semantic row in the
block, and posts the existing host `copy` action. The synthetic model is never
edited.

Add exactly one arrow for the other direction: a zero-height view zone in the
modified editor with a `marginDomNode` containing
`arrow-revert-change codicon codicon-arrow-left` and `data-copy-key` /
`data-copy-side`. It appears on every changed/added row with a right-side cell,
rebuilds on document/swap/merge/diff changes and is removed outside merge mode.

There is no `arxml-diff-merge-margin` overlay, no `.arxml-merge-arrow` pill or
text button, no glyph-margin arrow and no custom arrow CSS. Monaco owns the
geometry, scroll tracking and clipping of both arrows.

A pure deletion is one built-in arrow for the whole block; it resolves to the
topmost semantic row so copying the container's cell range carries its subtree.

## 6. Preview and audit contract

Replace the pre-aligned one-sided audit with:

- per-side line counts differ for a one-sided block;
- no placeholder line decorations, no blank numbered placeholder rows;
- `.diagonal-fill` present on the missing side;
- native inserted/deleted line and indicator decorations present;
- the built-in right arrow (`codicon-arrow-right`) and the copy-left arrow
  (`codicon-arrow-left`) present in the modified gutter; both probes post the
  host `copy` and never edit the synthetic model;
- `diff-removed` supplies a pure left-only block so the built-in right arrow is
  exercised; `diff-body` supplies changed/added rows so the copy-left arrow is
  exercised;
- no custom `arxml-diff-merge-margin` / `.arxml-merge-arrow` /
  `arxml-diff-line-*` / `arxml-diff-word-*` / `arxml-diff-sign` /
  placeholder paint, and no semantic `overviewRuler` decorations;
- Monaco's native `.diffOverview` present; no `arxml-selected` / `arxml-subtree`
  decorations.

`diff-body` asserts the native paint, the copy-left arrow and the click probe;
`diff-removed` asserts the built-in arrow path.

## 7. Risks / rollback

- Native Monaco alignment may pair moved/renamed rows differently from the
  semantic table. Merge, selection and row mapping stay semantic; the body paint
  is the built-in view. This is the accepted tradeoff for built-in parity.
- A built-in deletion block can span several semantic rows; the arrow resolves
  to the topmost row, matching the container cell range that carries its subtree.
- The copy-left arrow is a zero-height view zone in the modified editor; it must
  rebuild after a model swap and be removed when Merge is off.
- Line numbers are the synthetic per-side line numbers (the display body), not
  raw ARXML file lines; the built-in diff behavior is the reference.
- Rollback: restore the aligned builder and custom body layer from the previous
  commit; no protocol or persisted-format migration.
