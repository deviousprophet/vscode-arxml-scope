# Search within filtered rows — implementation plan

## Ordered checklist

### 0. Dependency check

- [ ] `10-30-sidebar-shell-buttons` has landed: shared field/button CSS, toolbar layout and the
  sidebar tabs exist.
- [ ] The Conditions panel is no longer in the toolbar.

### 1. Pure search helpers

- [ ] Add `searchRows(rows, query, visible?)` and `stepMatch(matches, current, direction)` to
  `src/editor/filter.ts`.
- [ ] Unit tests: blank query, whole tree, filtered visibility, collapsed candidates,
  case-insensitive, no matches, wrapping, `current = -1`.
- [ ] Serialize both helpers into the page with the other filter functions.

### 2. Highlight override

- [ ] `appendHighlighted` uses the page's `highlightQuery` when it is a non-blank string, otherwise
  `filterQuery`.
- [ ] Declare `let highlightQuery = ''` in the editor and diff pages.
- [ ] Keep the two pages' row primitives byte-identical.

### 3. Toolbar fields

- [ ] Replace the find-bar plan with a `.search-box` next to the filter: decorative magnifier,
  `#search-input`, custom clear, prev/next `.nav-btn`, `#search-count`.
- [ ] Restyle the filter to the shared `.filter`/`.search-input` field style; keep its clear/count.
- [ ] Suppress native search cancellation for both fields; each has one custom X.
- [ ] Add page tests for field markup, shared classes, counts and disabled buttons.

### 4. Search behavior

- [ ] Add `searchQuery`, `searchMatches`, `searchIndex`, `highlightQuery`.
- [ ] Add `searchCandidates`, `refreshSearch`, `renderSearchUi`, `jumpToSearchMatch`,
  `firstMatchAtOrAfterSelection`.
- [ ] Add input, clear, prev, next, Ctrl+F, Escape, Enter/Shift+Enter and F3/Shift+F3 handlers.
- [ ] Jump expands ancestors, rebuilds, `ensureVisible`, `setSelection`, `renderWindow`, focus input.
- [ ] `applyFilterQuery` recomputes search candidates after the filter result; never clears filter.
- [ ] `setRows` recomputes search over the new rows, keeping query/current where possible.
- [ ] Clicking a matching row updates `searchIndex`.
- [ ] Closing/clearing search restores `highlightQuery = ''` and filter highlighting.

### 5. Tests

- [ ] Compiled page tests for the candidate rule, wrapping, count text, disabled buttons, filter
  count/visibility unchanged, re-scan persistence, highlight precedence.
- [ ] Source assertions for jump selection/expansion/focus.
- [ ] Existing filter/tree/conditions/diff/menu/editing suites remain green.

### 6. Gates and manual check

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run package`
- [ ] Extension Development Host: filter to a subtree, search within it, find a row inside a
  collapsed container, press Enter repeatedly, confirm wrap/selection/inspector update, filter count
  unchanged, one clear X per field and Hex Scope-style controls.

## Risky files

- `src/editor/renderHtml.ts` — search must not touch filter state; focus stays in the input.
- `src/editor/filter.ts` — helpers stay pure/serializable.
- `src/editor/rowView.ts` — highlight fallback affects the diff page; keep both declarations.
- Toolbar layout — two fields plus actions must wrap/shrink without overlap.

## Rollback

Remove the Search field/state/functions, the two helpers, the `highlightQuery` override and the
tests; restore the filter-only toolbar and filter highlighting. The sidebar and Conditions remain.
