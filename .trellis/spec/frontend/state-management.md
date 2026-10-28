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
outlive its text. A re-scan posts `{ type: 'model', rows, digits, selectedId }`; the message type is
kept because the value widget clears its edit state on it. The payload is row data, never a
full-tree HTML string.

## Webview state

| State | Owner | Survives a re-scan? |
|---|---|---|
| `rows`, `rowById` | page script | replaced by the re-scan payload |
| `selectedId` | page script | yes, via the host payload; `reconcileRowState` drops it only if the row is gone |
| `focusId` | page script | yes when its row is still rendered; `resolveFocusId` picks a roving fallback otherwise |
| `collapsed: Set<nodeId>` | page script | yes; pruned by `pruneCollapsed` and read by `flattenRows` |
| `filterQuery`, `filterResult` | page script | yes; the index is rebuilt and the query re-run against the new rows |
| `windowRange`, `main.scrollTop` | page script + browser | yes where possible; the scroll offset is restored and clamped by the new total |
| `displayRows`, `expandedIds` | page script | derived from the rows, collapsed set, filter and view |
| type-ahead buffer | page script | yes; it is a transient 2 s window |
| `valueEdit` / `pendingMove` / `flashId` | value widget | no; the re-scan message removes the input and clears the stale state |
| `viewState.view`, `viewState.inspectorHidden` | page + host state | yes, through `getState()/setState()` |

The collapsed set is the only state that must not be re-derived from the rendered order. Node ids
are path-based and include a declaration-order ordinal (see `nodeId.ts`); pruning only drops ids the
new row set no longer contains. The filter never writes the collapsed set: `filterRows` marks
matches/ancestors and `flattenRows` force-expands a collapsed ancestor for as long as a visible
descendant exists. Clearing the filter therefore restores exactly what the user had. `expandedIds`
is derived from the displayed list, so a filter-forced ancestor reports `aria-expanded="true"` and
does not show the collapsed stub.

## Pure helpers, serialized once

`pruneCollapsed`, `toggleCollapsed`, `collapsedIdsFor`, `moveTarget`, `reconcileRowState`,
`resolveFocusId`, `inspectorFields`, the virtual-scroll functions and the filter/flatten functions
live in `renderHtml.ts`, `virtualScroll.ts`, `renderRows.ts` and `filter.ts`. The page emits them
with `Function.prototype.toString()` (the virtual math through `virtualScrollScript()`). Tests
extract the page's own copy with `scriptTestUtils` and compile it, so "the page and the tests share
one definition" is an assertion rather than a claim. Do not add a second host-side implementation of
a view rule.

## Persistence

- **Within the page:** the shell (toolbar, inspector) lives outside the rows, so a re-scan cannot
  destroy it. The row store, flattening and window are rebuilt in place; there is no innerHTML swap.
- **Across a webview reload:** the view and details panel use
  `acquireVsCodeApi().getState()/setState()`. Validate the shape: a non-null, non-array object; hide
  only when `inspectorHidden === true`; `view` accepts only `document`/`tree`, else `document`.
- **In the browser harness:** `scripts/preview-ecuc.js` stubs `getState()/setState()` with a
  `localStorage` key, so the reload path can be observed without VS Code. The stub is a development
  aid, not a production storage layer.

## No derived artefacts

Nothing is written beside the user's file. The only write is the user's `<VALUE>` text through one
`WorkspaceEdit`; the inspector's Copy actions go to the clipboard, not the document. The harness
writes no files into the workspace; it serves from memory, reads the committed fixtures, and for
manual viewing may also read the optional local `../sample` directory. `preview:check` never includes
that directory, so CI does not depend on a developer's disk.
