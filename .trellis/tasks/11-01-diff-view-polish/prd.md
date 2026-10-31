# Diff view polish: scrollable header, inline word changes, no module gap

## Goal

Improve the diff and Document surfaces: remove the inter-module blank line in diff view, let the
schema/package header scroll with content instead of pinning, show exactly which words changed on a
changed diff row, and make selection highlight annotation rows across the selected subtree.

## Requirements

- **Module gap**: the one-line spacer before each module is removed in diff view only. No replacement
  divider. Document view keeps its current spacing.
- **Header**: the schema/package header is inside the same scroller as the rows in Document and in
  both diff panes. It scrolls away with the content. It remains presentation-only (not selectable, not
  searchable). No collapse and no line cap. Equal line padding stays so the two diff panes align.
- **Inline changes**: on `changed` diff rows, highlight changed words in both panes for row-visible
  text only: label, value/target, condition, variant, context. Tokens are identifier runs plus
  punctuation. Colors use the standard VS Code removed/inserted text backgrounds. Row tint stays.
  Added/removed rows keep full-line tint and no word highlight. Swapping panes follows the displayed
  side. Search `<mark>` keeps its background; changed words keep a 1px outline.
- **Selection highlight**: selecting a container or module highlights the annotation rows of its whole
  subtree in Document and in both diff panes. Annotation rows stay non-selectable and non-focusable.
  The diff uses one selected key to highlight the same subtree in both panes. Added/removed rows
  highlight only the pane that owns them; the blank side stays blank.
- Short name and `DEFINITION-REF DEST` changes stay row-level only; Details markers are out of scope.

## Acceptance

- [ ] Diff view shows no blank row between modules; Document view is unchanged.
- [ ] Header scrolls out of view in Document and both diff panes; rows start at the same y in both
  panes; header lines are not focusable or searchable.
- [ ] A changed row highlights only the changed tokens in the visible fields in both panes; unchanged
  tokens and surrounding text render normally.
- [ ] Added/removed rows show no word highlight; only their full-cell tint.
- [ ] Swap mirrors the word colors with the displayed panes.
- [ ] A search match inside a changed word shows the search background and keeps the changed-word
  outline.
- [ ] Selecting a container highlights descendant annotation rows in Document and both diff panes;
  clicking an annotation does nothing; an added/removed row highlights only its owning pane.
- [ ] Pure word-diff tests, page render tests, header scroll tests and selection tests cover the
  changes.
- [ ] `npm run check-types`, `npm run lint`, `npm test`, `npm run benchmark`, `npm run package` pass.
