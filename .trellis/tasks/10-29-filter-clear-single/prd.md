# Single filter clear button

## Goal

Show exactly one "X" clear control in the ECUC editor's filter box. The current page renders
Chromium's native search-input cancel button and the extension's custom `#filter-clear` button at
the same time, so the user sees two overlapping X's.

## Confirmed facts

- `renderHtml` emits `<input id="filter" class="filter" type="search" …>` followed by a custom
  `<button id="filter-clear" … hidden>` (`src/editor/renderHtml.ts:220`).
- Chromium (the VS Code webview engine) paints `::-webkit-search-cancel-button` for
  `input[type="search"]` when the input has a value. That is the second X.
- The custom button is toggled by the page script:
  `clearButton.hidden = filterInput.value.trim() === ''`
  (`renderHtml.ts`, `uxPolish.test.ts:192`).
- Existing clear behaviour is covered by `uxFilter.test.ts` and `uxPolish.test.ts`.

## Requirements

- **R1** Keep `input[type="search"]` for its searchbox semantics and native Escape behaviour.
- **R2** Hide the Chromium native cancel button and any native search decoration via a nonce-carrying
  CSS rule:

  ```css
  .filter::-webkit-search-cancel-button,
  .filter::-webkit-search-decoration {
    -webkit-appearance: none;
    appearance: none;
    display: none;
  }
  ```

- **R3** Keep the existing custom `#filter-clear` button as the only visible clear control:
  it is hidden while the query is blank, clears the query, returns focus to the input, resets the
  count and re-applies the filter on click.
- **R4** No layout change: the input keeps its right padding for the custom button, and the button
  keeps its current position, size and hover state.
- **R5** The empty-state "Clear filter" action is unchanged.
- **R6** No new dependency, script, or DOM element.

## Acceptance criteria

- [ ] **AC1** The rendered page CSS contains the `::-webkit-search-cancel-button` rule with
  `display: none` (and the decoration rule).
- [ ] **AC2** The page still contains exactly one element with `id="filter-clear"` and no other
  clear button inside `.filter-wrap`.
- [ ] **AC3** With a non-empty query, Chromium shows only the extension's X; with an empty query,
  the custom X is hidden.
- [ ] **AC4** Clicking the X clears the query, focuses the input, shows all rows and restores the
  count; Escape still clears the query.
- [ ] **AC5** The empty-state "Clear filter" still clears the query.
- [ ] **AC6** All existing filter/UX/POLISH tests pass unchanged.

## Out of scope

- Replacing the custom button with the native one.
- Changing the filter matching rules, debounce, highlighting or count text.
- Adding a search icon or changing the filter width.

## Dependencies

None. This is the first child in the batch because it is isolated.
