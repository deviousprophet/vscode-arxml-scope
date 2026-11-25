# Implementation plan — collapsed diff difference marker

- [x] Add `diffFoldIndicator.ts` with the subtree check and collapsed-key filter.
- [x] Unit-test changed, descendant, unchanged and one-sided cases.
- [x] Wire per-editor decoration updates to hidden-area changes, model replacement and Swap.
- [x] Add the glyph-margin dot style to `monaco.css`.
- [x] Extend `diff-collapsed` to record marker counts before and after expanding.
- [x] Add the audit requirement: one marker in each pane while folded, zero after expansion.
- [x] Run focused preview and unit checks.
- [x] Full `webview-preview` set, types, lint, tests, fallow and production bundle.
- [x] Commit and push the PR branch.

## Evidence

- `diffFoldIndicator.test.ts`: changed row, changed descendant, unchanged subtree and one-sided
  added row (3 passing).
- `diff-collapsed` records markers `{ modified: 1, original: 1 }` while folded, `{ 0, 0 }` after
  expansion, and `{ 1, 1 }` after folding from the other side.
- The marker is a 6px amber glyph-margin dot; the cell stays transparent and no text or count is
  added.
- Full preview set: all states pass (`failed: 0`).
- 923 tests passing; types, lint, fallow (dead-code 0, complexity 0, duplication 0), production
  bundle and `git diff --check` pass.
