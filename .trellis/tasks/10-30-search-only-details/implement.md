# Implement — Search-only toolbar, one Details section, distinct Search highlighting

## Checklist

- [x] **1. Rename and trim the query module**
  - `git mv src/editor/filter.ts src/editor/treeQuery.ts`.
  - Keep `haystack`, `matchRanges`, `searchRows`, `stepMatch`, `flattenRows`, `ancestorIds`, the flat
    row types and the row interface (renamed `TreeRow`).
  - Delete the filter tree/index/result/debouncer helpers and `visible`/`filterActive` flatten
    options; simplify `flattenRows` to collapse + braces.
  - Update `searchRows` to scan the whole row list and drop the candidate flag parameter.
- [x] **2. Update row/view imports**
  - `renderRows.ts` imports `haystack` from `treeQuery`.
  - `rowView.ts` drops the `filterQuery` global fallback; `appendHighlighted` uses `highlightQuery`
    unless given a query. `valueSpan`/`metaSpan` accept an optional query.
  - `diffPage.ts` passes its `filterQuery` to `valueSpan`/`metaSpan` so its own highlight is unchanged.
- [x] **3. Remove the Filter from the page**
  - Delete the filter wrapper/input/X/count/empty markup and CSS.
  - Delete the filter DOM refs, state, debouncer, refresh/apply/clear/update functions, listeners and
    the `#empty-clear` click branch.
  - Remove `query` from `RowState`/`reconcileRowState` and `setRows`.
  - Build the display list with `flattenRows(rows, { collapsed, braces: true })`.
  - Make `searchCandidates` search the whole row store; adjust comments.
- [x] **4. Merge Details**
  - Replace four sections and three sashes with one `sb-details` section/body.
  - Rewrite `updateInspector` to emit all fields/actions into the single body; drop per-pane empty
    lines and keep the no-selection empty panel.
  - Point the details editor's `showSidebarSection` call at `sb-details`.
  - Remove the details-pane references and update sidebar comments.
- [x] **5. Highlight all matches and the current match**
  - Add `data-search-current` in `buildNodeRow` from `currentMatchId()`.
  - Add the stronger `mark` rule keyed by that flag.
  - Re-render the window when `syncSearchToSelection` changes the current index.
- [x] **6. Tests**
  - Delete `filter.test.ts` and `uxFilter.test.ts`.
  - Rename `filterRows.test.ts` → `treeQuery.test.ts`; keep flatten/ancestor/brace tests and drop
    filter/debouncer cases.
  - Update `search.test.ts` for the single toolbar field, whole-tree search, no filter fallback and
    the current-match flag/CSS.
  - Update `virtualPage`, `uxPolish`, `uxDocument`, `uxDocumentInteractions`, `sidebarShell` and any
    other page-string assertions.
  - Keep a regression test that the page has no Filter input/X/count/empty state or `filter-` class.
- [x] **7. Docs**
  - Update `.trellis/spec/frontend/component-guidelines.md` and `state-management.md`.
  - Update `CHANGELOG.md`: remove the filter entry, add the Search-only/single-Details/highlight
    entry.
  - Update the PR #12 body if its summary mentions the filter.
- [ ] **8. Validate**
  - `npm run check-types`
  - `npm run lint`
  - `npm test` (364 passing)
  - `npm run package` (`webview boot check: OK (editor + diff)`)
  - Extension Development Host: not observed in this environment. Manual pass still needed for the
    toolbar (Search only), all-match/current-match marks, a collapsed-subtree jump, the one Details
    section, value/container editing, tab switching, Conditions and the semantic diff.

## Result

- Automated gate: `check-types`, `lint`, `test` (364 passing) and `package` all green.
- The editor page has one query field; its state/engine, CSS, tests and specs contain no query-filter
  implementation. The semantic diff keeps its own filter and Changes-only toggle unchanged.
- Details is one scrolling section (`sb-details`) with no rendered sash. Both tabs therefore render
  one section each.
- The Extension Development Host was not available here; record that as unverified rather than a pass.

## Validation commands

```powershell
npm run check-types
npm run lint
npm test
npm run package
rg -n -i "filter" src/editor .trellis/spec/frontend CHANGELOG.md
```

The last command is a review aid, not a blanket failure: array `.filter(...)` calls and the diff
page's own filter are legitimate. It must show no editor Filter field, `filterQuery`, `filterRows`,
`filterResult`, `filter-clear`, `filter-wrap`, `updateFilterUi`, `applyFilterQuery` or
`createFilterDebouncer`.

## Review gates

- After step 3: compile/type-check, then inspect the rendered page string for any Filter remnant.
- After step 4: run the sidebar/details tests and check the page boots.
- After step 6: run the full suite.
- Before commit: `npm run package` and the Extension Development Host check.

## Rollback points

1. Before the module rename: restore `src/editor/filter.ts` and its imports.
2. After the page changes: revert `renderHtml.ts`, `rowView.ts`, `renderRows.ts` and `diffPage.ts`
   together; they are one contract.
3. Before committing: `git restore --staged .` / `git checkout --` the working files, or reset the
   single task commit while keeping the branch's earlier commits.
