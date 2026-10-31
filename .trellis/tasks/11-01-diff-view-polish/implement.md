# Implementation plan

1. **Pure word diff**: add `src/core/diff/wordDiff.ts` and unit tests (`src/test/core/wordDiff.test.ts`)
   for tokenization, LCS, empty sides, punctuation/path tokens and adjacent-segment merging.
2. **Module gap**: remove the diff-only gap computation and CSS; keep Document unchanged. Add a diff
   page test asserting no `data-gap` and base row height.
3. **Header**: move the header into `.document-tree-scroll`, add header-height offset to
   `getRowsScrollTop`/`setRowsScrollTop`, and update jsdom tests for DOM order, offset arithmetic and
   `scrollToIndex`.
4. **Inline rendering**: add the `wordDiff` context to `buildDocumentNodeRow`; compute displayed-field
   pairs in `diffViewer.renderRow` for `changed` rows; add CSS for removed/inserted word backgrounds
   and search overlap.
5. **Swap/search/added-removed coverage**: page tests for both panes, swap mirroring, search `<mark>`
   overlap, and no word spans on added/removed rows.
8. **Selection highlight**: set `data-subtree` on annotation rows; extend the subtree CSS to
   `.comment`; compute the selected subtree key set from merged diff rows and pass it to both panes;
   add Document and diff tests, including added/removed rows.
9. **Docs/spec**: update `component-document-tree.md`, `component-diff-view.md`,
   `css-guidelines.md`, `editor-lifecycle.md` and `docs/DIFF.md` with the final behavior.
10. **Gates**: `npm run check-types`, `npm run lint`, `npm test`, `npm run benchmark`,
    `npm run package`; verify the diff fixture in the Extension Development Host if available.

## Validation commands

```bash
npm run check-types
npm run lint
npm test
npm run benchmark
npm run package
```

## Rollback

One task commit; revert it. No data, schema or user settings change.

## Review gates

- Phase 2.2 check by `trellis-check` against this plan and the specs.
- Phase 3.3 spec update, then Phase 3.4 commit.
