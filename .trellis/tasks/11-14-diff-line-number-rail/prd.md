# Diff view line-number rail overlap

## Problem

In the semantic diff, a changed, added or removed row draws a 3 px status rail as an
inset edge on the **line-number cell** (`documentTree.css` gutter overlay,
`diffView.css`), not only on the code cell:

```css
.document-tree-lines[data-side="left"]  .document-tree-line-number[data-status="removed"] {
	box-shadow: inset 3px 0 0 var(--diff-removed-edge);
}
.document-tree-lines[data-side="right"] .document-tree-line-number[data-status="added"] {
	box-shadow: inset 3px 0 0 var(--diff-added-edge);
}
```

The gutter column is exactly `lineNumberColumns` `ch` wide, the number cell has **no
padding**, and the digits are right-aligned. Once a file has enough lines for a 4–5 digit
number, the leftmost digit reaches the cell's left edge and the 3 px rail sits on top of
it. The number is still readable for short files, which is why the fixtures miss it, and
becomes clipped-looking on a real file where the highlight is present.

## Expected

- The line number is never overlapped by a status rail: every digit is fully legible at
  any line count (1–6 digits) and for all three statuses.
- The status rail stays visible for added/changed/removed rows on both panes, and stays
  aligned with the same row's code cell.
- The fix changes no code-cell content position: a row's text must not shift horizontally
  when a status appears or disappears (no layout jump while scrolling or toggling
  Show diff / Context).
- The gutter keeps its fixed width, vertical scroll sync and right-aligned tabular digits.
- The selection/focus rail behaviour is unchanged unless the plan explicitly unifies it.
- Theme tokens only: no new colour literal, no hard-coded pixel colour.

## Direction (to be confirmed in design)

Place the status rail on the **right edge** of the line-number cell — the boundary
between the gutter and the code — instead of its left edge:

```css
box-shadow: inset -3px 0 0 var(--diff-added-edge);   /* per status/side */
```

This keeps the rail adjacent to the row it describes, leaves the digits clear, and needs
no width change. Alternatives to weigh: a dedicated 3 px column between gutter and code,
or left padding on the number cell plus a wider gutter (adds width and shifts numbers).

Open question: the selection/focus rail also uses `inset 2px 0 0` on the same cell
(`body[data-view="document"] …`). Decide whether it moves too, or whether the two rails
are deliberately on opposite edges; either way the number must stay clear in a selected,
changed row.

## Acceptance criteria

- [ ] A fixture/benchmark-scale document (≥ 1,000 lines, so 4-digit numbers) shows a
      status rail that does not touch any digit, in both panes and after a swap.
- [ ] Added/changed/removed rows keep a visible, correctly coloured rail.
- [ ] The code cell's own rail (where it remains) and the gutter rail agree on the row's
      status and side.
- [ ] No horizontal shift of row text or the gutter when statuses change.
- [ ] A CSS/DOM test asserts the rail edge for each status and pane side, and a page test
      covers a selected + changed row (no overlap, correct classes/attributes).
- [ ] `npm test`, `npm run lint`, `npm run design:lint` pass; the colour-literal tests
      still pass.
- [ ] `docs/DIFF.md` (if it states where the rail sits) and the design-system notes are
      consistent with the result.

## Out of scope

- Redesigning the diff row tint, the changed-word marks, or the gutter width.
- The editor Document view's line numbers, except where the shared gutter rule is touched.
- Any change to the diff model, matching, or the merge mode.

## Notes

- The shared gutter lives in `documentTree.css`; the diff-specific rails live in
  `diffView.css`. A fix that only edits `diffView.css` is preferred: the Document view
  keeps its current selection rail.
- Reproduce with the synthetic large fixture or a 1,000+ line file, not a 20-line fixture.
