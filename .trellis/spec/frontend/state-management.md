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

## Webview state

| State | Owner | Survives a re-scan? |
|---|---|---|
| `rows`, `rowById` | page script | replaced by the re-scan payload |
| `selectedId` | page script | yes, via the host payload; `reconcileRowState` drops it only if the row is gone |
| `focusId` | page script | yes when its row is still rendered; `resolveFocusId` picks a roving fallback otherwise |
| `collapsed: Set<nodeId>` | page script | yes; pruned by `pruneCollapsed` and read by `flattenRows` |
| `filterQuery`, `filterResult` | page script | yes; the index is rebuilt and the query re-run against the new rows |
| `windowRange`, `main.scrollTop` | page script + browser | yes where possible; the scroll offset is restored and clamped by the new total |
| `displayRows`, `expandedIds`, `subtreeIds`, `guideLevels` | page script | derived from the rows, collapsed set, filter and selected subtree |
| type-ahead buffer | page script | yes; it is a transient 2 s window |
| `detailsEdit` / `pendingMove` / `flashId` | details editor | no; the re-scan message clears stale state and rebuilds the details input |
| `uiState.inspectorHidden` | page + host state | yes, through `getState()/setState()` |

The collapsed set is the only state that must not be re-derived from the rendered order. Node ids
are path-based and include a declaration-order ordinal (see `nodeId.ts`); pruning only drops ids the
new row set no longer contains. The filter never writes the collapsed set: `filterRows` marks
matches/ancestors and `flattenRows` force-expands a collapsed ancestor for as long as a visible
descendant exists. Clearing the filter therefore restores exactly what the user had. `expandedIds`
is derived from the displayed list, so a filter-forced ancestor reports `aria-expanded="true"` and
does not show the collapsed stub.

## Pure helpers, serialized once

`pruneCollapsed`, `toggleCollapsed`, `collapsedIdsFor`, `moveTarget`, `reconcileRowState`,
`resolveFocusId`, `subtreeRowIds`, `guidesFor`, `inspectorFields`, the virtual-scroll functions and the
filter/flatten functions live in `renderHtml.ts`, `virtualScroll.ts`, `renderRows.ts` and `filter.ts`.
The page emits them with `Function.prototype.toString()` (the virtual math through
`virtualScrollScript()`). Tests extract the page's own copy with `scriptTestUtils` and compile it, so
"the page and the tests share one definition" is an assertion rather than a claim. Do not add a
second host-side implementation of a view rule.

## Persistence

- **Within the page:** the shell (toolbar, inspector) lives outside the rows, so a re-scan cannot
  destroy it. The row store, flattening and window are rebuilt in place; there is no innerHTML swap.
- **Across a webview reload:** the details panel uses
  `acquireVsCodeApi().getState()/setState()`. Validate the shape: a non-null, non-array object; hide
  only when `inspectorHidden === true`. An old saved `view` is ignored; there is no second view. The
  reload round trip is observed in the Extension Development Host, which is the only place the state
  API exists.

## No derived artefacts

Nothing is written beside the user's file. The only write is the user's `<VALUE>` text through one
`WorkspaceEdit`; the details panel exposes Jump to target for a followable reference and Reveal in source.
No script reads a local sample directory: the preview, sample and benchmark scripts were dev-only and
have been removed, so no CI step depends on a developer's disk.
