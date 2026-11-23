# Design — VS Code-style diff body surface

## 1. Current body

`diffMonaco.ts` uses Monaco's diff editor over two pre-aligned synthetic documents. It already has:

- semantic row/status data in `documentModel` (`DiffDocument`);
- `leftLineKeys` / `rightLineKeys` and `rowLine` from `buildAlignedSyntheticDocuments`;
- custom selection/subtree decorations and glyph-margin copy arrows;
- `diff-one-sided` placeholder decorations and neutral fills;
- a custom toolbar (`Merge`, `Show all`/`Show diff`, search, etc.).

It does not have VS Code's physical diff body: +/− signs, a diff status column with the built-in
margin geometry, a built-in-looking copy-arrow margin, word-level diff spans, or editor-settings
driven density.

## 2. Shared body contract

Expose one small adapter (in `diffMonaco.ts` or a helper module) for the children:

```ts
interface BodyRow {
  key: string;
  status: 'unchanged' | 'changed' | 'added' | 'removed';
  leftLine?: number;
  rightLine?: number;
  changes: readonly DiffChange[];
  leftCell?: DiffCell;
  rightCell?: DiffCell;
}
```

- `bodyRows()` iterates `documentModel.rows` and resolves both line numbers from `aligned`.
- `owningSides(row)` is the existing `left`/`right` presence.
- `mergeAction(row, side)` is the existing copy/delete action used by merge clicks.
- No new semantic matching or line-diff engine.

## 3. Gutter and margin

- Add body classes on the diff editor host and both editors:
  `arxml-diff-body`, `arxml-diff-gutter`, `arxml-diff-status`, `arxml-diff-merge-margin`.
- **+/− signs:** use a line decoration with a line-number or before-content class per semantic
  status on the owning side. Keep the VS Code gutter width and line-number column. The exact
  placement must be measured against the reference; do not invent a new column.
- **Copy arrows:** keep the existing `arxml-merge-arrow-left/right` glyph-margin actions and
  `wireMergeClicks` host path. Restyle the glyphs to the VS Code diff margin geometry and show
  them only in merge mode on the owning side. No separate revert icon in merge mode.
- Outside merge mode show +/− signs only.
- Missing-side placeholders keep the `diff-one-sided` neutral contract; no signs/arrows on the
  placeholder side.
- Use `lineNumberClassName`/`glyphMarginClassName` and a scoped CSS prefix; no `!important`
  outside the documented Monaco placeholder override.

## 4. Line and word highlights

- Line fills: semantic status decorations on the owning side using VS Code diff color roles
  (`--vscode-diffEditor-insertedLineBackground` / removed / modified, with the existing readable
  fallbacks). Do not rely on Monaco's line diff on the pre-aligned text.
- Word spans: add a pure `wordDiffSpans(left, right)` helper (core/diff) that returns changed
  ranges for the two semantic cell texts. Add `afterContentClassName`/decoration ranges for the
  words. Test the helper with add/remove/replace/prefix/suffix and empty strings.
- Placeholders stay unpainted; real-side fills remain.
- Selection/subtree tint remains above the diff fill but must not recolor text.

## 5. Whitespace, indentation and density

- Pass the existing `MonacoSettings` to both diff editors: font family/size/line height/weight,
  `renderWhitespace`, `indentationGuides`, `wordWrap`/column if already supported, `minimap:false`,
  `lineDecorationsWidth`, `glyphMargin` and the existing `diffEditor` options.
- If the diff protocol does not carry settings, add the smallest host->page settings payload
  consistent with the editor page; do not add a second settings source.
- CSS: line height, content padding, gutter widths, indentation and font must derive from the
  shared editor settings / VS Code variables. No new fixed palette except documented fallbacks.
- Visual only: do not add an Ignore Whitespace behavior or toggle.

## 6. Tests / preview

- Unit: word spans, status→line mapping, owning-side signs/arrows, placeholder exclusions.
- Preview: a fixed `diff-body` state with changed/added/removed/renamed rows and a one-sided row;
  expose the body row/line data for the visual-proof child.
- Keep `diff-one-sided`, merge, selection, search, collapse and all existing audits green.

## 7. Risks / rollback

- Monaco exposes line-number/glyph decoration classes, but the exact DOM can change between
  versions; scope CSS and let the visual-proof audit fail on drift.
- Pre-aligned placeholders must never receive a sign/arrow/fill.
- Rollback: remove the body classes/decorations, word-span helper and settings wiring; the
  semantic diff, toolbar and host merge remain.
