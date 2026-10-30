# Search within filtered rows — technical design

## 0. Toolbar layout

```html
<div class="toolbar">
  <div class="filter-wrap">
    <input id="filter" class="filter" type="search" placeholder="Filter" aria-label="Filter the ECUC tree">
    <button id="filter-clear" class="filter-clear" …>…</button>
  </div>
  <div class="search-box">
    <span class="search-icon" aria-hidden="true">…magnifier…</span>
    <input id="search-input" class="search-input" type="search" placeholder="Search"
           aria-label="Search the ECUC tree" autocomplete="off" spellcheck="false">
    <button id="search-clear" class="nav-btn search-clear" title="Clear search" aria-label="Clear search" hidden>…</button>
    <button id="search-prev" class="nav-btn" title="Previous match (Shift+F3)" aria-label="Previous match" disabled>…</button>
    <button id="search-next" class="nav-btn" title="Next match (F3)" aria-label="Next match" disabled>…</button>
    <span id="search-count" class="search-count" role="status" aria-live="polite"></span>
  </div>
  <span class="grow"></span>
  <button id="collapse-all" class="sb-btn sb-btn-secondary">…</button>
  <button id="expand-all" class="sb-btn sb-btn-secondary">…</button>
</div>
```

- Filter and Search use the same `.filter` / `.search-input` field rules from the shell child:
  26px, 180px flexible, input tokens, 3px radius, editor font, focus border.
- Search adds a decorative magnifier prefix, `.nav-btn` prev/next, a custom clear and a 14ch
  tabular count. It does not add a second bar below the toolbar.
- The toolbar is a single flex row; at narrow widths the fields shrink (`flex: 1 1 140px`) and labels
  hide. Both inputs keep their `aria-label`.
- `type="search"` for both; the native cancel button is suppressed for `input[type=search]`, and each
  field has exactly one custom X.

## 1. State and data flow

```
filter input ──► filterQuery / filterResult.visible ─┐
                                                     ├─► searchRows(rows, searchQuery, visible)
search input ──► searchQuery ────────────────────────┘
                                                     │
                                                     ▼
                                          searchMatches: number[] (row indices)
                                                     │
                     Enter / buttons / F3 ───────────┴─► searchIndex
                                                     │
                                                     ▼
                                  expandAncestors → rebuildDisplay → ensureVisible
                                                     → setSelection (keep focus in Search)
```

The filter remains the only thing that changes visibility. Search reads `rows` and the filter's
visibility flags; it never writes `filterQuery`, `collapsed` or `filterResult`.

## 2. Pure helpers (`src/editor/filter.ts`)

```ts
export function searchRows(
  rows: readonly FilterRow[],
  query: string,
  visible?: readonly boolean[]
): number[];

export function stepMatch(
  matches: readonly number[],
  current: number,
  direction: 1 | -1
): number;
```

- Case-insensitive, trimmed query; blank query returns `[]`.
- `visible[i] === false` rows are not candidates; `visible === undefined` means the whole tree.
- Collapsed state is irrelevant; the filter visibility includes ancestors.
- `stepMatch` wraps and handles `current = -1`.

## 3. Page state

```js
let searchQuery = '';
let searchMatches = [];   // row indices
let searchIndex = -1;     // index into searchMatches
let highlightQuery = '';  // search highlight precedence
```

`highlightQuery` is the highlight override. `rowView.ts` changes its fallback:

```ts
const needle =
  query === undefined
    ? typeof highlightQuery === 'string' && highlightQuery.trim() !== ''
      ? highlightQuery
      : filterQuery
    : query;
```

Both pages declare `let highlightQuery = ''`; the diff page leaves it empty.

## 4. Refresh and jump

```js
function searchCandidates() {
  return searchRows(rows, searchQuery, filterResult ? filterResult.visible : undefined);
}

function refreshSearch(startAtSelection) {
  const previousRow = searchMatches[searchIndex];
  searchMatches = searchCandidates();
  if (searchMatches.length === 0) {
    searchIndex = -1;
  } else if (previousRow !== undefined && searchMatches.includes(previousRow)) {
    searchIndex = searchMatches.indexOf(previousRow);
  } else {
    searchIndex = startAtSelection ? firstMatchAtOrAfterSelection() : 0;
  }
  highlightQuery = searchQuery.trim() === '' ? '' : searchQuery;
  renderSearchUi();
  renderWindow(true);
}
```

- Search input change: `refreshSearch(true)` and jump to the first match.
- Filter change: `applyFilterQuery` calls `refreshSearch(false)` after `rebuildDisplay`; the current
  match is kept if still allowed, otherwise the first remaining match (or none).
- `setRows`: recompute matches from the new rows, keep the query and current row by id when
  possible.
- Collapse/expand: no candidate recomputation.
- Clicking a matching row while search is active updates `searchIndex`.

`jumpToSearchMatch(index)`:

```js
const id = rows[searchMatches[index]].id;
if (expandAncestors(id)) rebuildDisplay();
const displayIndex = displayIndexById.get(id);
if (displayIndex !== undefined) ensureVisible(displayIndex);
setSelection(id);
renderWindow(true);
renderSearchUi();
searchInput.focus({ preventScroll: true });
```

- `setSelection` updates the inspector and tint.
- Focus stays in Search; `focusRow` is not used.
- A target no longer displayed after a filter change is a no-op.

`firstMatchAtOrAfterSelection()` uses the selected row index; no selection or all matches before it
wraps to the first.

## 5. Count and controls

- `1 / N` for a non-blank query with matches, `0 / 0` for no matches, empty for a blank query.
- Previous/next disabled when `searchMatches.length === 0`.
- The clear action is visible only with a non-blank query.
- Ctrl+F focuses and selects the input; Escape clears the query and returns focus to the tree.
- Enter/Shift+Enter in the input and F3/Shift+F3 while search is active cycle matches.
- The Search field is outside `#tree`; its keys never reach the tree handler.

## 6. Styling

- Reuse the shell's `.search-input`/`.filter` field rules and `.nav-btn` buttons.
- `.search-box` is a flex row with 3px gap; `.search-icon` is a muted 12px prefix inside the field.
- `.search-count` is 14ch, right-aligned, tabular numerals, description foreground.
- No new colour literal; no inline style; no separate column/row of controls.

## 7. Tests

Pure:
- `searchRows`: blank query, all rows, filtered visibility, collapsed rows candidates,
  case-insensitivity, no matches.
- `stepMatch`: next/previous wrap, `current = -1`, empty list.

Page:
- Toolbar shell: separate Filter and Search fields, shared field classes, one clear X each, count,
  prev/next disabled by default.
- Ctrl+F focus, Escape clear, Enter/Shift+Enter/F3 wrapping.
- Typing marks matches and leaves the filter count/visibility unchanged.
- Active filter candidate set; filter change recomputes without clearing.
- Jump expands ancestors, selects, keeps focus in the input (source + compiled helpers).
- Re-scan keeps query/current; highlight precedence and restoration.
- Existing filter/tree/conditions/diff/menu/editing suites remain green.

## 8. Trade-offs

- **Toolbar field instead of a separate bar** matches Hex Scope and uses the space freed by moving
  Conditions to the sidebar.
- **Live search with a decorative magnifier** instead of a run button; Hex Scope runs on demand, but
  live matching is simpler and fits the existing filter interaction.
- **Filter defines candidates, collapse does not** is the only rule that lets Search open a collapsed
  result without changing filter meaning.
- **Search highlight overrides filter highlight** while non-blank; the filter count still shows it
  is active.
- **No persistence** matches the filter; a reload starts with a blank search.
