# Research — diff view chevron and selection

Source evidence collected from the working tree at `782614e` (v0.6.0 behaviour, no source changes made).

## Rendering path

`diffViewer.renderRow()` builds a `.diff-row` per display line and delegates the visible markup to the
shared document row builder:

| Step | Where | What it does |
|---|---|---|
| diff row shell | `src/webview/diffViewer.ts:426-479` | `.diff-row`, status/key/selected/search attributes; ARIA + `aria-expanded` only when `side === 'left'` |
| options | `src/webview/diffViewer.ts:315-332` | `expandedIds` holds only the currently displayed row when `flat.expanded`; `selectedId` starts `undefined` |
| override | `src/webview/diffViewer.ts:493-498` | sets `selectedId` to the row key when it is the selection |
| node build | `src/webview/components/documentTree/documentRows.ts:66-112` | `role`, `aria-expanded` (line 81), `data-node-id`, `data-kind`, `data-selected` (line 95), `data-subtree` |
| diff strip | `src/webview/diffViewer.ts:358-364` | removes `role`, `aria-level`, `aria-posinset`, `aria-setsize`, **`aria-selected`**, **`aria-expanded`** from that node |

`DocumentTreeView.buildRow` (`documentTreeView.ts:311-320`) stamps `data-document-index` and forwards
clicks (`documentTreeView.ts:558-571`) to `onRowClick(index, event)`.

## Chevron

- Icon: `src/webview/render/rowView.ts:37-50` always returns the chevron-right shape.
- Rotation: `src/webview/components/documentTree/documentTree.css:33-35` only rotates
  `.node[aria-expanded="true"] > .row > .twisty svg`.
- Visibility: `documentTree.css:357-369` (hover/focus/collapsed rules) — the diff body is
  `<body data-view="document" data-page="diff">` (`src/host/webviewShell.ts:78`), so those apply.
- The diff sets `aria-expanded` on `.diff-row`, which no rule reads, and only on the left pane.

Result: both panes always show `>`, and collapsing never changes the icon.

## Selection

- `renderRow` marks the `.diff-row` with `data-selected` (`diffViewer.ts:455-457`) and the inner node
  with `data-selected` through `selectedId` (`diffViewer.ts:494`).
- `updateSelection()` (`diffViewer.ts:648-667`) re-applies `data-selected` to `[data-key]` elements in
  both panes after every render.
- Style: `src/webview/components/diffView/diffView.css:168-172` (`--sel-bg` + 1 px `outline`) versus
  `documentTree.css:477-507` (`--sel-container-bg`, 2 px inset `--rail`, `--sel-outline`,
  focus-within variants). Tokens: `src/webview/styles/tokens.css:38-42`.
- Subtree tint: `documentTree.css:472-476`, driven by `data-subtree` from `documentOptions.subtreeIds`
  (`diffViewer.ts:329` + `selectedSubtreeIds()` at `diffViewer.ts:300-314`).

### Wiring gap

`src/webview/components/diffView/diffView.ts:38-58`: `onRowClick` is registered for `this.left` only.
`DocumentTreeView.onClick` returns at `documentTreeView.ts:559-561` when the callback is missing, so
right-pane clicks are ignored entirely.

### Existing coverage

`src/test/webview/page/diffPage.test.ts` clicks `#diff-pane-left` rows (lines 630, 653, 708) and asserts
`data-subtree` on both panes and the F7 selection (lines 261-266). No test clicks the right pane and no
test asserts the chevron rotation attribute.

## Constraints

- `diffViewer.ts` is bundled for the webview only; `documentTree.css` is shared by both pages because
  `diffView` mounts two `DocumentTreeView` instances.
- Repository rule: no new runtime dependency, no new CSS token (`styles/tokens.css` is the single
  token source), diff stays read-only.
- Existing page tests read the CSS as text for a few rules, so a selector rename must update them.

## Open question

Whether the diff should also print the document view's `{ … }` marker on a collapsed container
(`documentTree.css:370-373`). It is stripped today by the same `aria-expanded` removal but was not
reported; treated as a non-goal.
