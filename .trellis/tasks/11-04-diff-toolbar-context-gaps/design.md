# Design — diff toolbar, row polish and context gaps

## Boundaries

| Layer | File | Change |
|---|---|---|
| Pure diff | `src/core/diff/diffModel.ts` | `diffVisibility(..., contextLines)`, gap rows in `flattenDiffDocument`, `DiffGap` |
| Core tests | `src/test/core/diffModel.test.ts` | Context window and gap expand/collapse |
| Toolbar | `src/webview/components/toolbar/toolbar.ts` / `.css` | Icon-over-label buttons, two view groups, Context toggle, remove summary |
| Page | `src/webview/diffViewer.ts` | Context state, expanded gaps, gap rendering/click handling, no badge/summary |
| Diff CSS | `src/webview/components/diffView/diffView.css` | Added leading edge, gap rows, remove badge/dashed underline |
| Page tests | `src/test/webview/page/diffPage.test.ts`, `src/test/webview/components/toolbar.test.ts` | Toolbar groups, gap expand, context, no counts/badge |

## 1. Toolbar

- Shared icon helper: 18px inline SVG, `aria-hidden`.
- Main diff controls use `.tool.diff-tool` with `flex-direction: column`, 18px icon, 10px label. The
  component CSS owns the button shape; the page CSS owns the toolbar grid and height.
- Two `.view-switch` groups on the left:
  - `#diff-view-all` / `#diff-view-diff`
  - `#diff-mode-semantic` / `#diff-mode-strict`
- `#diff-prev`, `#diff-next`, `#diff-context` and `#diff-swap` sit in the centre group.
- `#diff-context` is a standalone `aria-pressed` toggle. `setViewMode(changesOnly)` disables it in
  Show all; `setContext(active)` paints it.
- Remove `#diff-summary` and `DiffToolbar.setSummary`.
- `#diff-match-status` is the live pending status in the right group before Search; it ellipsizes.
- The toolbar uses `min-height` so icon/label metrics can grow it.

## 2. Context visibility

```ts
export function diffVisibility(
  rows: readonly DiffRow[],
  changesOnly: boolean,
  contextLines = 0
): boolean[]
```

After the existing change/ancestor pass, for every non-unchanged row mark source rows
`i - contextLines .. i + contextLines` visible and walk their ancestors. Default 0 preserves existing
callers/tests. The page calls it with `contextActive ? 5 : 0`.

## 3. Gap rows

```ts
export interface DiffGap {
  key: string;   // gap:<first hidden row key>
  from: number;  // first hidden source index
  to: number;    // exclusive
  count: number;
  expanded: boolean;
}
```

`DiffDisplayRow` adds `'gap'` to the left/right kind and an optional `gap`.

`flattenDiffDocument` options add `expandedGaps`. It scans maximal `visible === false` runs, builds a
gap per run, and marks rows in expanded gaps as effectively visible. A gap row is emitted once at the
run start. Collapsed: skip to `to`. Expanded: keep the header and walk the run normally, so the header
remains a collapse control.

Gap rows are not selectable tree nodes. `renderRow` branches on `flat.gap` before reading the source
row; the displayed left pane renders the toggle and the right pane renders the line only. The whole
split row is clickable; the inner button is the keyboard focus target. The page keeps
`expandedGaps: Set<string>` and rebuilds the display on toggle.

## 4. Row styling

- Added right cell: `box-shadow: inset 3px 0 0 var(--diff-added-edge)`.
- Remove `.diff-match-badge` and the `data-rename-implied` dashed underline; keep `DiffMatch` and the
  internal summary for tests.
- Remove the summary slot and all `setSummary` calls.

## 5. State and compatibility

- `contextActive` defaults true, 5 lines; it is page-local and not persisted.
- `expandedGaps` resets in `setDocument`; it survives view switches.
- `swap` does not rebuild the document; the gap control follows the displayed left pane.
- No model/output change for semantic/strict; the prepared-document cache is untouched.

## 6. Rollback

Revert the page/toolbar/CSS changes and the two core helpers (`contextLines`, gap emission). No data
or manifest migration is involved.
