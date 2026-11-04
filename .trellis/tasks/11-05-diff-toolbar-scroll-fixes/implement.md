# Implement — diff toolbar grouping and scroll behavior

1. **Toolbar markup/CSS**
   - Rename `Show diff only` to `Show diff` in the label, title and aria-label.
   - Reorder the left group: view switch, divider, Context, divider, Semantic/Strict, divider,
     Prev/Next.
   - Move Swap into an absolutely centered toolbar group so it stays over the pane divider.
   - Add `.toolbar-divider` styling; keep fixed button boxes and the 1040px/720px label breakpoints.
   - Update `toolbar.test.ts` order, divider count and label assertions.

2. **Pinned header**
   - In `DocumentTreeView.mount`, append the header to `root`, then the scroller; do not put the
     header inside the scroller.
   - Update the header CSS comment/own padding so the header sits above the scroll padding.
   - Change `getRowsScrollTop`/`setRowsScrollTop` to add/subtract only `padTopHeight()`.
   - Update `diffViewer.captureAnchor` `inHeader` to use padding only.

3. **Document-tree tests**
   - Assert the header is a direct child of the root, not the scroller.
   - Assert `setRowsScrollTop(200)` sets `scrollTop` to `200 + padding` (no header height) and
     `getRowsScrollTop()` returns 200.
   - Assert `scrollToIndex(500, 'start')` uses `500 * rowHeight + padding`.
   - Keep the header measurement/cache test.

4. **Scroll verification**
   - Add a page/document-tree assertion that the scroll content starts with the top spacer, not the
     header.
   - Confirm `DiffView.getScrollTop`/`setScrollTop` still mirrors the follower.
   - Manually check wheel from the top, middle and bottom, and drag the left scrollbar.

5. **Docs/spec**
   - Update `docs/DIFF.md`: pinned header, toolbar order, `Show diff` label, centered Swap.
   - Update the frontend specs that currently say the header scrolls with content.

6. **Verify**
   - `npm run check-types`
   - `npm run lint`
   - `npm test`
   - `npm run benchmark`
   - `npm run package`
   - `npx @vscode/vsce ls`

## Review gates

- **Gate A:** toolbar order/divider/label tests and document-tree header/offset tests pass.
- **Gate B:** full suite, package and manual scroll checks green; editor header still works.
