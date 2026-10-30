# Search within filtered rows (toolbar Find)

## Goal

Keep the filter as a visibility control and add a separate **Search** field in the toolbar that
jumps to a matching row instead of hiding everything else. Search operates on the rows the filter
currently allows; with no filter it searches the whole tree. The search and filter fields share the
Hex Scope search-bar visual style, and search uses the shared nav/clear/count controls.

## Confirmed facts

- `filterRows` produces `visible` (matches plus ancestors); `flattenRows` hides rows without touching
  the collapsed set (`src/editor/filter.ts`, `src/editor/renderHtml.ts`).
- `rows` is the full DFS row store; `filterResult.visible` is the filter's displayed set. Both
  survive a re-scan.
- `expandAncestors(id)`, `ensureVisible(index)` and `setSelection(id)` already support jumping and
  selecting without moving focus.
- `matchRanges` gives case-insensitive occurrences; `EcucRow.haystack` is the lower-cased label +
  short name + value used by the filter.
- Hex Scope's search bar is a toolbar flex row: 26px input-background field, 28px nav icon buttons,
  a 14ch tabular count and a clear action (`searchBar.ts`, `searchBar.css`).
- `10-30-sidebar-shell-buttons` provides the shared field style, `.nav-btn`/`.sb-btn` buttons and the
  sidebar shell. The Conditions panel no longer occupies the toolbar.
- `Ctrl+F` is not currently intercepted by the page.

## Requirements

### Toolbar fields

- **R1** The toolbar has a **Filter** field and a separate **Search** field. Both use the shared
  Hex Scope-style field: 26px height, input-background/foreground/border, 3px radius, editor font
  12px, focus border, one custom clear X, native search cancel suppressed.
- **R2** The Search field has a decorative magnifier prefix, previous/next `.nav-btn` actions, a
  custom clear action and a 14ch tabular `current / total` count. It has no separate find-bar panel.
- **R3** `Ctrl+F` focuses and selects the Search field; `Escape` clears the query. `Enter` /
  `Shift+Enter`, the buttons and `F3` / `Shift+F3` cycle matches and wrap.
- **R4** The Filter field keeps its existing filtering, clear, Escape behavior and count, but adopts
  the shared field style and tabular count.
- **R5** On narrow widths the two fields shrink/wrap without overlapping the toolbar actions; labels
  may hide but the fields keep an accessible name.

### Candidate set

- **R6** Search is case-insensitive over the same fields as the filter: label, short name and
  displayed value (`row.haystack`).
- **R7** When the filter is active, candidates are the rows in `filterResult.visible` (the rows the
  filter displays, including context ancestors). When the filter is blank, candidates are all rows.
- **R8** Collapsed state does not remove a row from the candidate set. Search finds rows inside
  collapsed containers and expands the ancestors when it jumps.
- **R9** A filter change recomputes the candidate set for the existing query. If the current match is
  no longer allowed, search selects the first remaining match or reports no matches; it never clears
  the filter.

### Jump behavior

- **R10** Typing starts at the first match at or after the current selection (wrapping to the first
  row). Enter/Shift+Enter, the next/previous buttons, and F3/Shift+F3 cycle and wrap.
- **R11** Jumping expands collapsed ancestors, rebuilds the display, scrolls the match into view and
  selects it (updating the inspector). Focus stays in the Search input so Enter can repeat.
- **R12** Clicking a matching row while search is active makes that row the current match.

### Highlighting and state

- **R13** While the Search query is non-blank, row labels, values and short names mark Search
  occurrences. Search highlighting takes precedence over filter highlighting for visible rows;
  clearing Search restores the filter's marks. Filter visibility/count are unchanged either way.
- **R14** Search state (query, current match) survives a re-scan and a filter change; matches are
  recomputed and the current match clamped. It is not persisted across editor reloads.
- **R15** Search does not write files, add a dependency, alter the filter's matching rules, or change
  selection semantics outside a jump.

### Accessibility and styling

- **R16** Search and Filter inputs have accessible labels; the count is a polite live region;
  nav/clear buttons have accessible names; controls have visible focus; disabled next/previous are
  announced as disabled.
- **R17** All controls use the shared `.nav-btn`/`.sb-btn`/`.search-input` classes and
  `--vscode-*` tokens; no new colour literal or inline style.

## Acceptance criteria

- [ ] **AC1** The toolbar shows separate Filter and Search fields with the same field style; Search
  has prev/next/clear/count and Ctrl+F focuses it.
- [ ] **AC2** Typing a query marks matches but leaves all filtered rows visible; the filter's count
  and visibility do not change.
- [ ] **AC3** With an active filter, only rows displayed by that filter can be matches; changing the
  filter recomputes the candidate set without clearing the filter.
- [ ] **AC4** With no filter, a match inside a collapsed container is found; jumping expands its
  ancestors, scrolls it into view and selects it.
- [ ] **AC5** Enter, Shift+Enter, the buttons, F3 and Shift+F3 move through all matches and wrap.
- [ ] **AC6** The count reads `1 / N`, `0 / 0` or is hidden for a blank query; the buttons disable
  appropriately.
- [ ] **AC7** Search highlighting is visible while non-blank; clearing it restores filter highlights.
- [ ] **AC8** Search query/current match survive a re-scan and a filter change where possible.
- [ ] **AC9** Filter and Search each show exactly one clear X (native cancellation suppressed).
- [ ] **AC10** All existing filter, tree, Conditions, diff, menu and editing tests pass; new pure and
  page tests cover the candidate rule, wrapping and jump.
- [ ] **AC11** No new dependency, no write path, no hard-coded colour or duplicate field style.

## Out of scope

- Replacing the filter with search.
- Searching across files or the whole workspace.
- Regex, whole-word, case-sensitive or scope-limited search modes.
- Persisting search across editor reloads.
- A separate find-bar panel or a search history.
- Marking all filter matches while Search is active.

## Dependencies

- `10-30-sidebar-shell-buttons` must land first for the shared field/button CSS and the toolbar
  layout. This task owns the Search behavior and the Filter field restyle.
- Independent of the Conditions edit-flow child; both consume the shell.

## Notes

- The search field is live; Hex Scope's explicit magnifier button is replaced by a decorative prefix
  and live matching. The nav/count/clear layout is copied.
- Real focus, scroll, contrast and keyboard behavior still need an Extension Development Host check.
