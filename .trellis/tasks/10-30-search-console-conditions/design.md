# Design — Search on Enter, visible marks, console errors and icon Conditions actions

## 1. Search state machine

Page state stays:

```text
searchInput.value        the raw typed text
searchQuery             the committed, executed query ('' before the first run)
searchMatches           row indices for searchQuery
searchIndex             current match position
highlightQuery          committed query used by appendHighlighted
```

New functions:

- `executeSearch()` — reads `searchInput.value`; a blank query calls `resetSearchResults()`.
  Otherwise commits `searchQuery`, runs `refreshSearch(true, undefined, false)`, then jumps to the
  first match. No match leaves the tree unselected and renders the window.
- `resetSearchResults()` — clears `searchQuery`, matches, index and `highlightQuery`, repaints the
  Search UI and the window without touching the field text.
- The `input` listener only:
  - returns when the typed value still equals the committed query;
  - keeps the clear X in step while nothing has run yet;
  - otherwise calls `resetSearchResults()` so old marks disappear until Enter.
- The `keydown` listener:
  - Enter: `executeSearch()` when the typed value differs from the committed query, else
    `cycleSearch(shift ? -1 : 1)`;
  - Escape: clear and return focus to the tree.
- `renderSearchUi` uses `searchInput.value` only for the clear X; count, current position and nav
  disabled state use the committed `searchQuery`, so a pending query shows no false count.
- Re-scan still calls `refreshSearch(false, previousMatchId)` over the whole row store.

## 2. Highlight tiers

The page defines two fixed, documented dark-theme variables:

```css
--match-bg: rgba(234, 179, 8, 0.32); /* all matches */
--match-hi: rgba(234, 179, 8, 0.7);  /* current match */
```

`mark { color: inherit; background: var(--match-bg); }` and
`.node[data-search-current="true"] > .row mark { background: var(--match-hi); }`.
No `--vscode-editor-findMatch*` dependency: a theme that resolves those to transparent can no longer
hide the marks. The existing forced-colors rule keeps its transparent background + outline override.
`buildNodeRow` already sets `data-search-current` from `currentMatchId()`.

## 3. Console-only page errors

`pageError.ts` keeps `pageErrorScript` for the diff page's notice. Add `consoleErrorScript`:

```text
function <installer>() {
  function report(text) { console.error('<label>: ' + text); }
  window.<reporter> = report;
  window.addEventListener('error', ...);
  window.addEventListener('unhandledrejection', ...);
}
<installer>();
```

`renderHtml` emits it first, before `acquireVsCodeApi`, with
`installerName: 'ecucInstallConsoleErrors'`, `reporterName: 'ecucReportError'`,
`label: 'ECUC editor'`. Remove `#notice`, its CSS and all editor `pageErrorScript` use. The existing
`window.ecucReportError(...)` calls in `readInitialRows` and condition parsing keep working and now
log only.

## 4. Conditions icon actions

`conditionIconButton` already creates an `.act-btn` with a 12px SVG path, `title` and `aria-label`.
Use it for Save and Cancel:

- Save: `condition-save`, label `Save <name>`, title `Save this condition value`, check path
  `M3 8.5l3 3 7-7`.
- Cancel: `condition-cancel`, label `Cancel <name>`, title `Discard this change`, X path
  `M4 4l8 8M12 4l-8 8`.
- Edit/Remove stay as they are.
- CSS: drop the text-button padding for `.condition-save`/`.condition-cancel`; set their `opacity: 1`
  so they are visible for the whole edit session, while Edit/Remove keep the parent hover/focus
  reveal from `.act-btn`. The row class and `.condition-*` class names stay, so the delegated click
  handler and tests that drive it are unchanged.

## 5. Tests

- `render.test.ts`: assert the console installer is emitted before `acquireVsCodeApi`, has no
  document/notice dependency, and both error listeners call `console.error`. Assert the page has no
  `#notice`/`ecucInstallErrorSurface`.
- `uxDocument.test.ts`: remove notice assertions; assert the page has no notice element and that
  recoverable messages still route to the Details/Conditions status.
- `search.test.ts`: rename typing tests; assert the input listener never calls `refreshSearch` or
  `jumpToSearchMatch`; assert Enter calls `executeSearch`; assert the fixed yellow tiers and current
  row rule. Add a compiled `executeSearch` test if the page wiring alone is too shallow.
- `uxConditions.test.ts`: assert Save/Cancel use `conditionIconButton`, have no text content, keep
  their action classes and accessible names; update CSS assertions.
- `a11y`, `uxPolish` and spec docs: update any notice/filter wording.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Enter is pressed twice quickly | First Enter commits and jumps; second Enter sees the same committed query and cycles. |
| User edits a query after a run | Input handler resets the result set; Enter runs the new query. |
| Theme makes marks invisible | Fixed yellow tiers independent of `--vscode-editor-findMatch*`. |
| Diff page loses its notice | Keep `pageErrorScript` and its diff call unchanged. |
| Conditions keyboard flow breaks | Only button markup changes; delegated `.condition-save`/`.condition-cancel` handlers and input keys stay. |
| Icon-only buttons lose discoverability | `title` and `aria-label`; Save/Cancel are visible for the edit session. |
