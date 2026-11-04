# Fix diff view collapse chevrons and container selection highlight

## Goal

The semantic diff must behave like the ECUC document view for the two tree affordances a user touches
first: the collapse chevron shows the live expanded state, and a clicked container shows the same
selection highlight the document page shows.

## Context

Two defects reported against the diff panel (`arxmlScope.diff`):

1. **Chevron never rotates.** A container row always draws `>`; expanding it never shows `v`.
2. **Container selection is not visible.** There is no highlight like the one the document page paints
   on a selected container and its subtree.

Verified in source (v0.6.0, `fix/validation-false-positives`):

- `src/webview/components/documentTree/documentRows.ts:81` puts `aria-expanded` on the inner `.node`.
- `src/webview/diffViewer.ts:358-364` (`stripDocumentNode`) **removes** `aria-expanded` from that node
  because the diff row is the accessible tree item.
- Rotation lives only at `documentTree.css:33` (`.node[aria-expanded="true"] > .row > .twisty svg`), so
  nothing rotates the chevron in the diff.
- The diff row copies the flag at `diffViewer.ts:476`, but only inside `if (side === 'left')`, and
  `diffView.css` has no rule that reads it.
- `DiffView.mount()` (`src/webview/components/diffView/diffView.ts:38-58`) passes `onRowClick` to the
  **left** `DocumentTreeView` only. `DocumentTreeView.onClick` returns immediately when the callback is
  absent (`documentTreeView.ts:558-561`), so a click in the right pane selects nothing in either pane.
- The diff's own selection rule (`diffView.css:168-172`) paints `--sel-bg` (14 % mix) plus a 1 px
  `outline`. The document view (`documentTree.css:483-502`) paints `--sel-container-bg` (45 %),
  a 2 px inset `--rail` and `--sel-outline`, and keeps only the *inner* node in sync with `selectedId`.
  The left-pane node therefore renders a container highlight, the right pane never does, and the two
  surfaces do not look the same even when the selection lands.

## Requirements

- **S1 — Live chevron.** A container row in either pane shows a rotated chevron while it is expanded
  and the right-pointing chevron while it is collapsed. The state updates on twisty click, `Space`,
  `ArrowLeft`/`ArrowRight`, and Collapse/Expand All.
- **S2 — Same signal in both panes.** The expanded state reaches the DOM on both panes, not only the
  left one. Use the existing document-row signal where possible instead of a second source of truth.
- **S3 — Click selects in either pane.** Clicking a node row in the left or the right pane selects that
  row (same key), keeps both panes in sync, and does not move focus in a way that breaks keyboard
  continuation.
- **S4 — Document-view parity.** A selected container shows the same container background, rail,
  `--sel-outline` and descendant subtree/brace/comment tint in both panes as the document page does.
  Reuse the existing document tokens and rules; do not introduce a new colour token or a second
  selection style.
- **S5 — No regressions.** Arrow/Home/End navigation, `F7`/`Shift+F7`, Enter/reveal, search-current
  highlight, swap, added/removed side tinting, virtual scrolling and collapsing remain unchanged.
  Structural (brace/comment-only) rows stay non-selectable.
- **S6 — Tests.** Each new behaviour gets a jsdom page test that fails when its branch is removed:
  expanded chevron in both panes, click-in-right-pane selection, and the container highlight class
  in both panes. CSS assertions read the built/source stylesheet the existing page tests read.
- **S7 — Scope.** No model changes, no protocol change, no new setting, no read/write behaviour change.

## Non-goals

- Adding the document view's `{ … }` collapsed marker to the diff (unreported; separate call).
- Redesigning diff status colours or the badge/summary work planned in
  `11-04-diff-semantic-rename-matching`.
- Making the right pane a second ARIA tree; it stays the decorative mirror.

## Acceptance criteria

- [ ] A container that is expanded shows a rotated chevron in **both** panes; collapsing it restores
      the right-pointing chevron in both panes; Collapse All / Expand All update every row.
- [ ] Clicking a container in the right pane selects it: both panes mark the row `data-selected="true"`,
      the node gets the document-view container background + rail, and its descendants get the subtree
      tint.
- [ ] Clicking a container in the left pane produces the identical result (no left/right difference).
- [ ] Clicking the empty (blank/structural) half of a row does not select it, and the twisty still
      only toggles collapse without changing the selection.
- [ ] Keyboard navigation, `F7`/`Shift+F7`, search-current and swap behave exactly as before.
- [ ] `npm run check-types`, `npm run lint`, `npm test` pass; no new CSS token, setting or dependency.
- [ ] Every new test fails when the code branch it covers is removed (mutation check).

## Notes

- Origin: user report on the diff panel after v0.6.0.
- S4 prefers deleting the diff-only selection rule in favour of the shared document rule when the
  attribute reaches the same element; the alternative (align the diff rule to the container tokens) is
  acceptable if the shared rule cannot be reused without leaking into structural rows. Decide at
  implementation and record which one was taken.
- Repository rule: the diff is read-only; nothing in this task touches `WorkspaceEdit` or file writes.
