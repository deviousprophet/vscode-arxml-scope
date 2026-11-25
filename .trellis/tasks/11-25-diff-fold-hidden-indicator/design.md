# Design — collapsed diff difference marker

## Seam

`diffMonaco.ts` already receives every hidden-area change through `onDidChangeHiddenAreas` and
already maps collapsed regions to row keys for fold synchronization. Reuse that state:

1. Read the editor's folding model.
2. Build the collapsed row-key set with `collapsedRowKeys`.
3. Keep only keys whose row subtree contains a non-unchanged row.
4. Map each key to the line in the model that editor currently shows.
5. Apply one Monaco decoration per key with `glyphMarginClassName: 'arxml-fold-has-diff'`.

`DiffDocument.rows` exposes `subtreeSize` and `status`. A helper scans the row and its descendants
and returns true on the first non-unchanged status.

## Decoration lifecycle

- Keep decoration IDs per inner editor.
- Recompute on `onDidChangeHiddenAreas` and after model replacement/swap.
- Clear all markers before recomputing so expanded rows cannot leave stale dots.
- The marker is glyph-margin only; no inline text, count, tooltip or layout change.

## CSS

`monaco.css` styles `.arxml-fold-has-diff` as a 6px round dot using the changed-row colour. The
glyph margin already exists on both diff editors.

## Tests

- `diffFoldIndicator.test.ts`: changed row, changed descendant, unchanged subtree, one-sided row.
- `diff-collapsed` preview probe records `.arxml-fold-has-diff` counts in both panes after
  folding `Items`; the audit requires at least one in each pane.
- The probe expands `Items` and records zero markers to prove cleanup.
- Existing full seeded set and product gates remain the regression net.
