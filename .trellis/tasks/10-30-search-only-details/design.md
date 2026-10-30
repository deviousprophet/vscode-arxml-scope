# Design — Search-only toolbar, one Details section, distinct Search highlighting

## 1. Module boundary

`src/editor/filter.ts` is renamed to `src/editor/treeQuery.ts`. It keeps only the row/query
primitives the surviving surfaces need:

```ts
interface QueryFields { label: string; shortName?: string; value?: string }
function haystack(node: QueryFields): string
interface MatchRange { start: number; end: number }
function matchRanges(text: string, query: string): MatchRange[]
interface TreeRow { id; parentId; level; subtreeSize; hasChildren; haystack }
interface FlattenOptions { collapsed?: ReadonlySet<string>; braces?: boolean }
function flattenRows(rows, options): FlatRow[]
function searchRows(rows, query): number[]
function stepMatch(matches, current, direction): number
function ancestorIds(rows, id): string[]
```

Deleted exports: `FilterFields`, `FilterNode`, `matchesQuery`, `filterTree`, `FilterIndex`,
`FilterResult`, `buildFilterIndex`, `filterRows`, `FilterDebouncer`, `createFilterDebouncer`.

`flattenRows` no longer takes `visible`/`filterActive`; it emits a subtree exactly when the row is
not collapsed and has children. Search expands ancestors explicitly before a jump, so no filter
visibility needs to force an expansion. `RowState` loses `query`; `reconcileRowState` keeps the
selection and prunes collapse ids only.

`renderRows.ts` imports `haystack` from `treeQuery.ts`. The `EcucRow.haystack` field and its
documentation remain (Search uses it).

## 2. Toolbar and page state

Markup (`renderHtml.ts`):

- Remove `.filter-wrap`, `#filter`, `#filter-clear`, `#count` and `#empty`/`#empty-text`/
  `#empty-clear`.
- Keep the Search box with `#search-input`, `#search-clear`, `#search-prev`, `#search-next`,
  `#search-count`; it becomes the first control in the toolbar.
- Remove `.filter-wrap`, `.filter`, `.filter-clear`, `#count` and empty-state CSS. The shared field
  rule becomes `.search-input` only. The media query shrinks `.search-box` only.

Page script:

- Remove `filterInput`, `countLabel`, `clearButton`, `empty`, `emptyText`.
- Remove `filterQuery`, `filterResult`, `filterIndex`, `filterDebouncer`, `refreshFilter`,
  `updateFilterUi`, `applyFilterQuery`, `clearFilter`, the filter input/clear listeners and the
  `#empty-clear` branch in `onRowClick`.
- `indexRows` only rebuilds the id maps.
- `rebuildDisplay` calls `flattenRows(rows, { collapsed, braces: true })`.
- `setRows` calls `reconcileRowState({ selectedId, collapsed }, incoming)`, then rebuilds, then
  `refreshSearch(false, previousMatchId)`.
- `searchCandidates()` returns `searchRows(rows, searchQuery)` (whole store).
- `refreshSearch` no longer receives filter state; its `render` parameter stays for typing.
- `clearSearch` no longer mentions filter marks.

## 3. Search highlight

`appendHighlighted(parent, text, query?)` defaults only to the page's `highlightQuery`. The old
`filterQuery` fallback is removed. `valueSpan(row, readOnly?, query?)` and
`metaSpan(row, query?)` pass an optional query through; the diff page passes its `filterQuery` so its
filter highlighting is unchanged, and the editor passes nothing so it uses `highlightQuery`.

`buildNodeRow` sets `node.dataset.searchCurrent = 'true'` when `searchQuery` is non-blank and
`row.id === currentMatchId()`. CSS:

```css
mark { background: var(--vscode-editor-findMatchHighlightBackground, ...); }
.node[data-search-current="true"] > .row mark {
  background: var(--vscode-editor-findMatchBackground, ...);
}
```

The selected-row tint is unchanged. `syncSearchToSelection` re-renders the window after updating the
current index so the data flag moves immediately.

## 4. One Details section

Markup replaces the four sections and three sashes with:

```html
<section class="sb-section sb-pane" id="sb-details" data-pane-id="sb-details">
  <head ...>Details</head>
  <div class="sb-body" id="sb-details-body" role="region">...</div>
</section>
```

`updateInspector` writes one body in reading order:

1. Kind + label.
2. Container editable short name/definition, or read-only definition/short name; variant; type.
3. Parameter value editor and integer formats.
4. Reference target/context and Jump to target when followable.
5. Condition text/state/reason, disabled-by-ancestor note, post-build conditions, annotations.
6. Reveal in source.

Empty rows are omitted rather than shown as four separate empty panes. With no selection the single
body shows the existing "Select a line" empty panel. `ecucDetailsEditor.beginDetailsEdit` calls
`showSidebarSection('sb-details')`.

The sidebar shell stays generic (tab activation, width, pane allocation, section collapse). With one
section per tab there are no sashes in the rendered page; sash-only behaviour is exercised only by
unit fixtures and points at no static HTML. `sidebarShell.ts` comments drop the filter wording.

## 5. Tests / specs / changelog

- Delete `src/test/editor/filter.test.ts` (nested filter-tree engine).
- Delete `src/test/editor/uxFilter.test.ts`; move the surviving Search-highlight assertions into
  `search.test.ts`.
- Rename `filterRows.test.ts` to `treeQuery.test.ts`; keep `flattenRows`, `ancestorIds`, brace and
  collapse tests; delete `filterRows`/index/debouncer tests.
- Update `search.test.ts`: one toolbar field, whole-tree candidates, no filter fallback, current-mark
  data flag and CSS.
- Update `virtualPage`, `uxPolish`, `uxDocument`, `sidebarShell`, `uxDocumentInteractions` and any
  page-string assertions for the removed filter and single Details body.
- Update `.trellis/spec/frontend/component-guidelines.md` and `state-management.md`; remove filter
  contracts and describe Search-only state, the single Details body and the two highlight tiers.
- Replace the CHANGELOG filter entry with the final Search-only/single-Details behaviour.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Removing `filterQuery` breaks the diff page's highlight | `valueSpan`/`metaSpan` take an explicit optional query; the diff page passes its filter query |
| Search cannot reach a collapsed subtree | Search scans the row store, not the display list; the existing `expandAncestors` jump path is kept |
| Single Details body loses the no-value/no-reference empty lines | Only meaningful fields render; the whole-panel empty state remains, and the tests assert the combined body |
| Re-scan drops the Search match | `setRows` still captures `currentMatchId()` before replacing rows and calls `refreshSearch(false, previousMatchId)` |
| Stale pane ids from the four old sections | `loadUiState` keeps unknown ids inert; no migration is needed because a missing pane id means "fresh" |
| Filter CSS left behind | A string assertion checks the page has no Filter field/control/count/empty state or `filter-` class |
