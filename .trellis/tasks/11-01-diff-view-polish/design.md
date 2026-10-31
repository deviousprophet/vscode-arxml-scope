# Design: diff view polish

## 1. Module gap

- `src/webview/components/documentTree/documentTree.css` and `diffView.css` add `padding-top:
  var(--ecuc-lh)` for `[data-gap="true"]`.
- `diffViewer.ts` computes the gap in `heightFn` and sets `element.dataset.gap` through
  `carriesDiffGap`.
- Remove the diff-only gap: delete `carriesDiffGap`, the `gap` term in `heightFn`, and
  `.diff-row[data-gap="true"]` CSS. Do not touch the Document `data-gap` path; Document already
  shows no gap.
- Test: a two-module diff has module rows with no `data-gap` and `heightFn` equals the base row
  height.

## 2. Scrollable header

`DocumentTreeView.mount()` builds `root > header + scroll > topSpacer + window + bottomSpacer`.
Change it to `root > scroll > header + topSpacer + window + bottomSpacer` so the header lives in the
scrolled content.

Virtual math currently subtracts only the scroller's top padding in `getRowsScrollTop()` and adds it
back in `setRowsScrollTop()`. Header height must join that offset:

```ts
headerHeight(): number        // header.offsetHeight, 0 when unmeasurable
getRowsScrollTop(): number    // max(0, scrollTop - padTopHeight() - headerHeight())
setRowsScrollTop(offset)      // setScrollTop(offset + padTopHeight() + headerHeight())
```

- Cache the header height; invalidate it after `setHeader`/`mount` and when `scroll.clientWidth`
  differs from the width used for the last measurement (a resize can reflow the header lines). Plain
  scroll renders reuse the measurement instead of re-reading `offsetHeight`.
- `scrollToIndex`, `virtualState`, `getVisibleRange` inherit the corrected offset; no other math
  changes.
- A refresh or a `Show all`/`Show diff only` switch while any part of a header is on screen restores
  the native scroll offset verbatim, so the header does not jump out of view. Once the header is
  scrolled away the row anchor keeps the first visible row stable.
- The header stays `role="presentation"`, `aria-hidden` where appropriate, not a tree item and not in
  the search haystack.
- Diff panes already pad the shorter header to `header.lines`; that keeps both scroll heights equal,
  so synchronized scrolling starts rows at the same y.
- In jsdom `offsetHeight` is 0; tests stub it and assert the offset arithmetic, DOM order
  (`scroll > header`) and that repeated renders reuse the measurement.

## 3. Inline word diff

### Pure helper

New `src/core/diff/wordDiff.ts`:

```ts
export interface WordSegment { text: string; changed: boolean; }
export interface WordPair { left: WordSegment[]; right: WordSegment[]; }
export function diffWords(left: string, right: string): WordPair;
```

- Tokenizer preserves whitespace; identifiers are `[A-Za-z0-9_]+`; each punctuation character is a
  token. `0x1F` stays one identifier token; `/Pkg/Diff` becomes `/`, `Pkg`, `/`, `Diff`.
- Longest-common-subsequence over token strings; unmatched tokens are `changed`.
- Merge adjacent segments with the same flag.
- One empty side marks the other side entirely changed.

### Page rendering

`diffViewer.renderRow` already builds each cell through `buildDocumentNodeRow`. Add an optional
`wordDiff` context to `documentRows.ts`:

```ts
interface DocumentWordDiff {
  label?: WordPair;
  value?: WordPair;
  meta?: Record<string, WordPair>; // condition / variant / context
}
```

- For `status === 'changed'` and both cells present, compare the displayed strings of each visible
  field: `label`, `shownValue` (value/target), and each `meta` part text.
- `buildDocumentNodeRow` renders the label, value and meta through a segment writer: each `changed`
  segment becomes `<span class="word-changed">`; on the left pane add `data-word-side="left"`
  (removed background), on the right add `data-word-side="right"` (inserted background).
- Search highlighting runs per segment: a search match inside a segment becomes `<mark>`; the
  changed-word span keeps its outline. Existing `appendHighlighted` behavior is preserved when no
  word diff is supplied.
- Added/removed rows pass no word diff; they keep the current full-cell tint.
- Swap: the renderer already picks displayed cells; segment classes are chosen from the displayed
  side, so colors mirror.
- Only rendered rows compute word diffs; no document-wide pass.

### CSS

In `diffView.css`:

```css
.diff-row .word-changed[data-word-side="left"] {
  background-color: var(--vscode-diffEditor-removedTextBackground, var(--diff-removed-bg));
  outline: 1px solid var(--diff-removed-edge);
}
.diff-row .word-changed[data-word-side="right"] {
  background-color: var(--vscode-diffEditor-insertedTextBackground, var(--diff-added-bg));
  outline: 1px solid var(--diff-added-edge);
}
.diff-row mark { background-color: var(--match-bg); /* existing search styling */ }
```

Forced-colors/high-contrast: use a dotted outline, no background, matching the existing overrides.

## 4. Selection highlight and annotation rows

- **Document**: `buildDocumentCommentRow` currently never sets `data-subtree`. Set
  `node.dataset.subtree = 'true'` when `context.subtreeIds.has(rowId)`, same as
  `buildDocumentBraceRow`. Annotation rows stay `aria-hidden` and non-selectable.
- **CSS**: extend the subtree-background selector to `.comment[data-subtree="true"] > .row`; add the
  same forced-colors/high-contrast outline used by `.node` and `.brace`.
- **Diff**: `documentOptions` currently passes `subtreeIds: new Set()`. Compute the selected subtree
  keys from the merged rows: index of `selectedKey`, then every row in its `subtreeSize` range. Pass
  that set to both panes' options. Node, brace and comment rows then highlight through the same
  `data-subtree` path. One `selectedKey` keeps the two panes in sync.
- **Added/removed rows**: keys exist on one side only; the other pane renders a blank cell and must
  not show a phantom subtree highlight.
- Recompute the set on every selection change; no cached stale subtree.
- Tests: Document annotation under a selected container; both diff panes highlight the same subtree;
  added/removed side only.

## 5. Compatibility and rollback

- Header offset changes only the component's internal scroll math; `getScrollTop`/`setScrollTop` still
  return the native scroller value for diff synchronization.
- Word diff is additive; unchanged rows render exactly as before.
- Roll back by reverting the single task commit; no data or schema change.
