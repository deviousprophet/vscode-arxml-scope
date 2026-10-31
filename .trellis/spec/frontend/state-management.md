# State Management

The extension has no store, no framework and no server state. State is split between the **host**
(the VS Code extension) and the **webview** (the inlined ECUC page), and the split is deliberate.

## Host state (`EcucEditorProvider`)

| State | Why it lives here |
|---|---|
| `panels: Map<uri, WebviewPanel>` | A source→editor command must reach the panel already showing the file |
| `selections: Map<uri, nodeId>` | A re-scan payload must carry the current selection; otherwise a document change moves it back to the node the editor opened at |
| `pending: Map<uri, nodeId>` | A selection requested before its panel exists, consumed on first paint |

The host re-scans on every `onDidChangeTextDocument` and on a settings change. It does not cache the
model: the row document is always built from a fresh scan (`buildRows`), so no range on screen can
outlive its text. A re-scan posts `{ type: 'model', rows, selectedId }`; the message type is kept
because the details editor clears its edit state on it. The payload is row data, never a full-tree
HTML string.

A container short-name edit changes the path-based id of the node being edited, so `editField`
stores the id the fresh scan predicts for the written text **before** `applyEdit`. The re-scan that
follows the write therefore carries the surviving id and the renamed container stays selected; a
refused write restores the previous selection entry. The prediction is only a hint — `applyEdit`
re-scans and refuses if the bytes moved.

## Webview state

| State | Owner | Survives a re-scan? |
|---|---|---|
| `rows`, `rowById` | page script | replaced by the re-scan payload |
| `selectedId` | page script | yes, via the host payload; `reconcileRowState` drops it only if the row is gone |
| `focusId` | page script | yes when its row is still rendered; `resolveFocusId` picks a roving fallback otherwise |
| `collapsed: Set<nodeId>` | page script | yes; pruned by `pruneCollapsed` and read by `flattenRows` |
| `searchQuery`, `searchMatches`, `searchIndex` | page script | recomputed over the full row store; the current match is kept by id where possible |
| `windowRange`, `main.scrollTop` | page script + browser | yes where possible; the scroll offset is restored and clamped by the new total |
| `displayRows`, `expandedIds`, `subtreeIds`, `guideLevels` | page script | derived from the rows, collapsed set and selected subtree |
| type-ahead buffer | page script | yes; it is a transient 2 s window |
| `detailsEdits` / `pendingMove` / `pendingFieldFocus` / `flashId` | details editor | no; the re-scan message clears stale state and rebuilds the details inputs |
| `uiState.tab / sidebarWidth / panes / collapsed` | page + host state | yes, through `getState()/setState()` |

The collapsed set is the only state that must not be re-derived from the rendered order. Node ids
are path-based and include a declaration-order ordinal (see `nodeId.ts`); pruning only drops ids the
new row set no longer contains. Search never writes the collapsed set: it scans the row store and a
jump expands the target's ancestors explicitly. `flattenRows` reads the collapsed set only, so
`expandedIds` comes from the display list's own `expanded` flag — the same expression that decides
whether `flattenRows` descends. Do not re-derive expansion from the next displayed row; that is a
second owner of the rule, and the reason the flag exists.

## Pure helpers, serialized once

`pruneCollapsed`, `toggleCollapsed`, `collapsedIdsFor`, `moveTarget`, `reconcileRowState`,
`resolveFocusId`, `subtreeRowIds`, `guidesFor`, `inspectorFields`, `ancestorIds`, the virtual-scroll
functions and the tree-query functions live in `renderHtml.ts`, `virtualScroll.ts`, `renderRows.ts`
and `treeQuery.ts`. The chunked `RowSearchEngine` lives in `rowSearch.ts` and is serialized with
`rowSearchScript()`.
The page emits them with `Function.prototype.toString()` (the virtual math through
`virtualScrollScript()`). Tests extract the page's own copy with `scriptTestUtils` and compile it, so
"the page and the tests share one definition" is an assertion rather than a claim. Do not add a
second host-side implementation of a view rule.

## Persistence

- **Within the page:** the toolbar, sidebar, tabs, sections and details panel live outside the rows,
  so a re-scan cannot destroy them. The row store, flattening and window are rebuilt in place; there
  is no innerHTML swap.
- **Across a webview reload:** the sidebar uses `acquireVsCodeApi().getState()/setState()` with one
  validated object: `tab` (`details`/`conditions`), `sidebarWidth` (clamped 260–900),
  `panes` (section id → saved px), `collapsed` (section ids). A missing/invalid field falls
  back to Details, 360px and default heights; a non-array object is ignored. The legacy
  `inspectorHidden` field is ignored and never written back. Only user actions (tab click, resizer
  release, sash release/reset when a pane pair exists, section toggle) write the preference; transient
  viewport clamping does not overwrite the saved width. The reload round trip is observed in the
  Extension Development Host, which is the only place the state API exists.

## Condition values

The ECUC editor's Conditions panel stores SW system-constant values as raw `{ name, value }` text in
`context.workspaceState` under `arxmlScope.conditionValues.v1`. They are never written beside the
ARXML. `ConditionValueStore` normalizes on load and save (trim, 200-entry/200-character caps, name
pattern `/?[A-Za-z_][A-Za-z0-9_.\-/]*`, last duplicate wins); the page sends raw entries and never
evaluates a condition. `buildRows` evaluates each node's own `SW-SYSCOND` with
`src/core/ecuc/syscond.ts` and carries `condition`/`disabled`/`disabledBy` on the row; a false
container or module disables its subtree, a false parameter/reference only itself, and `unknown`
never disables. Every rebuild (document change, settings, conditions message) uses the same map, and
a conditions message re-pushes rows instead of reloading the page. The embedded entries are the
first-paint copy only: the host answers the page's `ready` with the current entries, so a webview
reload cannot show (and then save) a stale list.

The panel discovers constants from `RowCondition.symbols` on every model push: unique names in the
row order the host sends, appended only when no row already shows them. Discovery never rewrites an
input and never posts a message, so a typed draft survives a re-scan. An empty committed value stays
visible in the table but is absent from the evaluation map, so a condition that uses it is `unknown`
and never disables a row. Scanned rows are read-only and cannot be removed; a manual row (a stored
name not referenced by the document) can be removed and that removal is persisted through the store.
Drafts live only in Edit mode; only Save (including committing a new Add draft), Remove and
Clear values send a `conditions` message. Opening Add alone sends nothing.

Structural actions are stateless from the page's point of view: the menu posts one `delete` or
`duplicate` message and closes. The host re-scans the document before planning and again inside
`applyStructureEdit`, so a stale plan is refused. A successful write relies on the existing
`onDidChangeTextDocument` re-scan; a deleted selection is cleared by `reconcileRowState`, while a
duplicate and a parameter copy leave the original selected. The menu is never persisted and is
hidden on any re-scan.

## Search state

`searchInput.value` is the raw typed text. `searchQuery`, `searchMatches` (row indices) and
`searchIndex` are the committed search and are page-local; they are not persisted across reloads.
Typing alone never searches: it only keeps the clear X in step, and a changed value cancels the
engine and invalidates the old result set. Enter runs the changed query through `RowSearchEngine`
(120 ms debounce, 24 ms slices, 512-row batches, 150 ms progress throttle, generation token) or
cycles an already-executed one; Shift+Enter goes backwards. The first streamed match is jumped to,
and completion preserves the current match by row id. A re-scan restarts the committed query
immediately over the full row store and preserves the current row id where possible. Search must
never write the collapsed set. `highlightQuery` is a transient page variable carrying the committed
non-blank query into the row primitives: every occurrence is marked, and the row that owns
`searchIndex` carries `data-search-current="true"` for the stronger mark. `searchRunning` drives the
`#search-busy` spinner. The toolbar holds Search as its only query field; there is no separate
find-bar panel. A jump posts the existing `select` message so the host keeps the row selected across
a re-scan; Search itself never changes rows or collapse state.

The diff page uses the same search contract with row **keys** instead of indices because its
candidate list changes with the view mode. `showChangesOnly` chooses the candidate set
(`status !== 'unchanged'` or all rows); a view switch restarts the committed query and keeps the
current key where possible. `swapped` is page-local and display-only. Neither the view mode nor the
swap state is persisted, and a refresh preserves both.

## Page errors

There is no page-error UI state. A console-only installer is emitted before `acquireVsCodeApi`; it
defines `window.ecucReportError` and forwards `error` / `unhandledrejection` to `console.error`.
Recoverable field/condition warnings still use the Details or Conditions status; they never create a
banner.

## No derived artefacts

Nothing is written beside the user's file. The only write is the text of the element the user
edited — a parameter's `<VALUE>` or a container's `<SHORT-NAME>` / `<DEFINITION-REF>` — through one
`WorkspaceEdit`; the details panel exposes Jump to target for a followable reference and Reveal in
source. No script reads a local sample directory: the preview, sample and benchmark scripts were
dev-only and have been removed, so no CI step depends on a developer's disk.
