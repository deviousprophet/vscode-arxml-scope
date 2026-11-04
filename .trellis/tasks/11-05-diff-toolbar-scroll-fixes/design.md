# Design — diff toolbar grouping and scroll behavior

## Boundaries

| Layer | File | Change |
|---|---|---|
| Toolbar markup | `src/webview/components/toolbar/toolbar.ts` | Group order, dividers, centered Swap, Show diff label |
| Toolbar CSS | `src/webview/components/toolbar/toolbar.css` / `diffView.css` | Divider rule, centered swap column, group spacing |
| Document tree | `src/webview/components/documentTree/documentTreeView.ts` | Mount header outside the scroller; row offset excludes header |
| Document tree CSS | `src/webview/components/documentTree/documentTree.css` | Header is a fixed flex row above the scroll region |
| Diff page | `src/webview/diffViewer.ts` | Anchor `inHeader` uses padding only; no header offset |
| Tests | `src/test/webview/components/documentTree.test.ts`, `toolbar.test.ts`, `page/diffPage.test.ts` | Header placement, offset math, toolbar order |

## 1. Toolbar

Markup order:

```text
toolbar-left:
  view-switch: Show all | Show diff
  divider
  Context
  divider
  view-switch: Semantic | Strict
  divider
  Prev diff | Next diff
toolbar-center:
  Swap sides
toolbar-right:
  mode status
  Search
```

- Each divider is `<span class="toolbar-divider" aria-hidden="true"></span>`, styled as a 1px vertical
  rule roughly the button height, with margins.
- The toolbar is a flex row: the left group is sized to content, the right group is pushed to the end,
  and the center group is absolutely positioned at `left: 50%` with a `translateX(-50%)`. That keeps
  Swap centered over the pane split regardless of how wide the left/right groups are.
- Labels remain icon-over-label; button boxes stay fixed size. Labels hide at <=1040px and compact
  further at <=720px.
- `Show diff only` becomes `Show diff` everywhere (label, title, aria-label).

## 2. Pinned header

`DocumentTreeView.mount` changes from:

```text
root > scroll > header + topSpacer + window + bottomSpacer
```

to:

```text
root > header + scroll > topSpacer + window + bottomSpacer
```

- `.document-tree` already is a column flex; the header is `flex: none`, the scroll is `flex: 1`.
- The header keeps its own border/background. The scroll padding remains the gap between the pinned
  header and the first row.
- `getRowsScrollTop()` becomes `scrollTop - padTopHeight()`.
- `setRowsScrollTop(offset)` becomes `offset + padTopHeight()`.
- `headerHeight()` remains available for measurement/caching, but no longer shifts row offsets.
- `diffViewer.captureAnchor` uses `native < padTopHeight()` for the `inHeader` flag; the header is
  always on screen and is not part of the scroller.

## 3. Scroll speed and drag

The old header inside the scroll region meant the native scrollbar and wheel had to traverse the header
height before the row offset changed. Moving the header out removes that dead zone:

- wheel/drag offset maps linearly to rows from the first pixel;
- the native scrollbar height equals the virtual row content (spacers + window), not rows + header;
- the follower sync still uses `setScrollTop` with `expectedTop`, so the right pane cannot bounce.

No new rAF path is needed; the existing `scroll` listener + render window remains the single path.

## 4. Compatibility

- The editor shares `DocumentTreeView`, so its schema/package header also becomes pinned. That is the
  same "header is not content" rule.
- The diff's pane header remains inside each pane's equal grid track; the scroller below it keeps the
  horizontal scrollbar and virtual window.
- Selection, search, swap, Context and the mode cache do not depend on header placement.

## 5. Rollback

Revert the mount order and the two offset methods, and restore the old toolbar group order. The
toolbar divider CSS is additive and can be removed independently.
