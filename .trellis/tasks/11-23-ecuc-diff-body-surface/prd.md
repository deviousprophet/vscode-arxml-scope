# Rework the ECUC diff body as a modified built-in diff

## Goal

Make the ECUC diff body a **modified version of Monaco/VS Code's built-in diff
view**, not a custom pre-aligned body. The built-in diff owns the per-side line
numbers, one-sided diagonal gaps, native line/word paint and the center diff
margin. The ECUC semantic layer stays as the source of truth for merge actions,
navigation and toolbar behavior; the custom selection tint is not painted.

## Confirmed scope

- Only three things are custom: the copy-to-left arrow, the current ARXML
  Scope toolbar, and the synthetic ECUC content.
- The middle area uses Monaco's built-in diff-margin/view-zone primitives; only
  the click handler is ARXML semantic copy.
- Both center arrows are merge-mode only and call the host `copy` action.
- Strict parity: no custom semantic selection/subtree tint, signs, line/word
  fills, overview ruler or unchanged-region styling.
- The copy-left arrow appears on every changed/added row with a right-side
  element; the built-in arrow stays where VS Code renders it.
- Content is the synthetic ECUC display with its synthetic per-side line
  numbers, not raw ARXML text/file lines.

## Requirements

- **Per-side body**
  - Build left and right synthetic documents from each side's own semantic rows.
  - Do not insert blank placeholder rows on the missing side.
  - Each side keeps its own line count, line numbers and folding ranges.
- **Built-in diff paint**
  - Let Monaco render inserted/deleted line fills, word spans, diff indicators,
    overview ruler and unchanged-region widgets.
  - Keep the ECUC syntax/theme and inherited editor settings.
  - One-sided blocks show the built-in diagonal fill on the missing side; the
    owning side keeps its normal diff paint.
- **Semantic layer**
  - Keep `DiffDocument` / semantic pairing as the merge source of truth.
  - Keep the current ARXML toolbar, Merge, search, collapse, Show all/Show diff
    and semantic Prev/Next.
  - Map semantic rows to per-side model lines for merge/navigation; do not create
    a second diff algorithm for the body.
- **Center merge margin**
  - Use Monaco's built-in diff-margin view zone and its
    `arrow-revert-change` arrow; rebind only the click to the host `copy`.
  - Add exactly one copy-to-left arrow with the same built-in classes in a
    zero-height view-zone `marginDomNode`.
  - Both arrows are Merge-mode only. Do not edit the synthetic models, add a
    custom overlay/pill/text arrow or paint a custom arrow.
  - A built-in deletion block maps to the first semantic row it contains; the
    copy-left arrow appears on every changed/added row with a right-side cell.
- **Settings / density**
  - Apply the inherited `MonacoSettings` to both diff editors.
  - Line height, font, whitespace, guides and gutter geometry come from the
    built-in editor.
- **Preserve**
  - One-sided content stays correct on the owning side; no fake empty container
    or synthesized brace on the missing side.
  - The `diff-body` and `diff-one-sided` preview states and audits, updated for
    the built-in body.
- **Do not**
  - Rebuild the diff body with custom DOM rows or pre-aligned blank placeholders.
  - Add inline mode, the VS Code diff toolbar or Ignore Whitespace behavior.

## Acceptance Criteria

- [ ] The diff uses per-side synthetic documents; a one-sided block shows a
      diagonal gap with no blank placeholder line numbers.
- [ ] Native diff line/word paint, indicators, ruler and unchanged-region
      widgets are visible; the old custom body paint/placeholder CSS is gone.
- [ ] The center merge margin is Monaco's built-in arrow plus one copy-left
      arrow in the modified gutter; both post the host copy and edit no model.
- [ ] Merge clicks keep the existing host copy/delete semantics and the current
      ARXML toolbar/navigation/search/collapse/Show all/Show diff behavior.
- [ ] `diff-body`, `diff-one-sided` and `diff-removed` audits pass against the
      built-in body, including native paint, the diagonal gap and both arrows.
- [ ] Full suite, fallow GREEN, preview shots and production bundle pass.

## Notes

- Continue on `feat/ecuc-diff-body-surface` (user decision: finish all tasks on
  one branch). Reopened from the archived body-surface task after the built-in
  diff review.
- The visual-proof task must use the new built-in-body DOM contract.
