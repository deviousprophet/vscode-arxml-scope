# Search-only toolbar, one Details section and distinct Search highlighting

## Goal

The ECUC editor keeps exactly one query control: **Search**. The old Filter is removed completely
with no trace in the UI, page state, engine, CSS, tests, specs or changelog. Search scans the whole
row store and jumps/selects matches instead of hiding rows. Every Search match is marked in the tree,
and the current match is visually stronger than the other matches. The four closely related Details
sections become one scrolling **Details** section with no pane sashes.

## Confirmed facts

- The toolbar currently renders a Filter field (`#filter`, `#filter-clear`), a filter count
  (`#count`), a filtered empty state (`#empty`, `#empty-text`, `#empty-clear`) and the Search field.
- The page owns `filterQuery`, `filterResult`, `filterIndex`, `filterDebouncer`,
  `updateFilterUi`, `applyFilterQuery` and `clearFilter`.
- `src/editor/filter.ts` mixes the removable filter engine with the search/flatten helpers that must
  stay: `haystack`, `matchRanges`, `searchRows`, `stepMatch`, `flattenRows`, `ancestorIds`.
- Search currently limits candidates to `filterResult.visible` and the highlight falls back to the
  filter query when Search is blank.
- The Details tab has four `.sb-section` panes (`sb-details-node`, `sb-details-value`,
  `sb-details-reference`, `sb-details-conditions`) separated by three `.sb-pane-sash` elements.
- `updateInspector` writes each of the four bodies independently; the details editor expands
  `sb-details-value` or `sb-details-node` before focusing a field.
- Search already jumps to a match, expands its ancestors, scrolls, selects it and keeps focus in the
  Search input; the current match is only distinguished by row selection.

## Requirements

- **R1 Remove the Filter completely.** No Filter input, clear control, count, empty state, filter
  query/result/index/debouncer, filter handlers, filter CSS, filter tests or filter terminology in
  the editor surface, state docs and changelog.
- **R2 Search is the only query control.** Search scans every row regardless of collapse or any other
  view state. A blank query matches nothing. It never hides a row and never writes the collapsed set.
- **R3 Search jumps and selects.** Typing starts at the selection, Enter/F3/Shift+F3 cycle with
  wrapping, a jump expands ancestors, scrolls the row into view and selects it while focus stays in
  the Search field. Clicking a matching row makes it current; clicking a non-match leaves the
  current match unchanged.
- **R4 All matches are marked, the current match is stronger.** Every occurrence of the query in the
  label, short name and value is wrapped in `<mark>`. The row that owns the current match carries a
  data flag that gets a stronger find-match background; other marked rows keep the subtler
  find-match-highlight background. The existing selected-row tint still applies.
- **R5 One Details section.** Node, value/formats, reference/context, conditions, annotations and
  the Details actions render in one scrolling `sb-details` body with one section header. There are no
  Details pane sashes. The section stays collapsible; focusing an edit field expands it.
- **R6 Preserve behaviour.** Conditions editing, notice routing (`#notice` is fatal boot only),
  semantic diff, sidebar tabs/width persistence, selection, re-scan, reveal/follow, and the shared
  row primitives keep working.
- **R7 No new dependency, file write, colour literal or inline style.** New colours are
  `--vscode-*` variables; text stays `textContent`; no model-derived HTML.

## Acceptance criteria

- [ ] **AC1** The editor page contains no Filter input, Filter clear button, filter count, filtered
  empty state, filter engine call, filter debouncer or filter CSS rule.
- [ ] **AC2** Search finds a row that is inside a collapsed subtree, expands its ancestors on jump and
  selects it. Search is case-insensitive and scans label, short name and value.
- [ ] **AC3** Search never changes the collapsed set, selection semantics or the row count.
- [ ] **AC4** Every occurrence of the query is marked in rendered rows; the current match's row has a
  distinct stronger mark and the selected-row treatment.
- [ ] **AC5** The Details tab renders one `sb-details` section with a single body and no sash; all node,
  value, reference, condition and annotation fields plus Jump/Reveal actions appear there.
- [ ] **AC6** Editing a parameter value or container field still focuses the correct input and expands
  the section; refusals still render inline and recoverable warnings still use the status surfaces.
- [ ] **AC7** The Filter tests are removed or rewritten for the search-only behaviour; flatten, search,
  ancestor, step and sidebar tests pass; `check-types`, `lint`, the full test suite and `package`
  pass.
- [ ] **AC8** No dependency, file write, colour literal, inline style or second renderer is added.

## Out of scope

- The semantic diff page's own filter and Changes-only toggle.
- Host message shapes, the scanner, the Conditions store/evaluator and the diff model.
- New keyboard shortcuts beyond the existing Search keys.
- Persisting the search query across a webview reload.
