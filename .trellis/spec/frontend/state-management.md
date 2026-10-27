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
model: the tree is always rendered from a fresh scan, so no range on screen can outlive its text.

## Webview state

| State | Owner | Survives a re-scan? |
|---|---|---|
| `selectedId` | tree script | yes, via the host payload and the rendered `aria-selected` |
| `collapsed: Set<nodeId>` | tree script | yes; pruned and re-applied by `reRenderTree` |
| `main.scrollTop` | the browser | yes; read before the swap and written back last |
| type-ahead buffer | tree script | yes; it is a transient 2 s window |
| `valueEdit` / `pendingMove` / `flashId` | value widget | no; the swap removes the input and clears the stale state |
| `viewState.inspectorHidden` | page + host state | yes, through `getState()/setState()` |

The collapsed set is the only state that must not be re-derived from the rendered order. Node ids are
path-based and include a declaration-order ordinal (see `nodeId.ts`); pruning only drops ids that the
new tree no longer contains. The filter never writes the collapsed set; it passes an `ancestors`
override to `applyCollapsed`, which is why clearing the filter restores exactly what the user had.

## Pure helpers, serialized once

`pruneCollapsed`, `toggleCollapsed`, `collapsedIdsFor`, `moveTarget` and `reRenderTree` live in
`renderHtml.ts` and are emitted into the page with `Function.prototype.toString()`. Tests extract the
page's own copy with `scriptTestUtils` and compile it, so "the page and the tests share one
definition" is an assertion rather than a claim. Do not add a second host-side implementation of a
view rule.

## Persistence

- **Within the page:** the shell (toolbar, inspector) lives outside `#main`, so a re-scan cannot
  destroy it. The tree region is the only thing swapped.
- **Across a webview reload:** the details panel uses `acquireVsCodeApi().getState()/setState()`.
  Validate the shape: a non-null, non-array object; hide only when `inspectorHidden === true`.
- **In the browser harness:** `scripts/preview-ecuc.js` stubs `getState()/setState()` with a
  `localStorage` key, so the reload path can be observed without VS Code. The stub is a development
  aid, not a production storage layer.

## No derived artefacts

Nothing is written beside the user's file. The only write is the user's `<VALUE>` text through one
`WorkspaceEdit`; the inspector's Copy actions go to the clipboard, not the document. The harness
writes no files into the workspace; it serves from memory, reads the committed fixtures, and for
manual viewing may also read the optional local `../sample` directory. `preview:check` never includes
that directory, so CI does not depend on a developer's disk.
