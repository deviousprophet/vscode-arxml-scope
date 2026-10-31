# Implementation plan

## Preconditions

- Branch `feat/arxml-scope-batch`.
- Current dirty guide/scroll/performance fixes are verified and committed first.
- `npm test` green before the first move.

## Steps

1. **Stabilize current diff fixes**
   - Single visible vertical scrollbar, wheel over either pane drives it.
   - Closing brace guides no longer self-overlap.
   - 3px split between panes matching Hex Scope.
   - Incremental virtual window render (only edge rows rebuilt).
   - Gates: 413+ tests, package boot check, large-file scroll probe.

2. **Webview skeleton and build**
   - Create `src/webview/{styles,render,components}`.
   - Add `loader: { '.css': 'text' }` to `esbuild.js`.
   - Move `virtualScroll.ts`, `rowView.ts`, `rowSearch.ts`, `treeQuery.ts`, `html.ts`, `jsonScript.ts`, `pageError.ts` to `webview/render/`; update imports.
   - Move tests to `src/test/webview/render/`.

3. **DocumentTree component**
   - Move `documentTreeView.ts`, `documentRows.ts` and the generated CSS into `components/documentTree/` with `documentTree.css`.
   - Composition roots import the component and inject its CSS string.
   - Tests move to `src/test/webview/components/documentTree.test.ts` (flat, matching Hex Scope).

4. **Editor components**
   - Extract toolbar, search bar, sidebar shell, Details/Conditions panels, details editor and context menu into their folders with CSS.
   - `renderHtml.ts` becomes `webview/editorViewer.ts` (composition root + page shell).
   - Editor tests mirror component ownership.

5. **Diff components**
   - `diffPage.ts` becomes `webview/diffViewer.ts`.
   - Two-pane surface, toolbar and sync live under `components/diffView/`.
   - Diff tests move to `webview/components/diffView/` and page-level tests to `webview/page/`.

6. **Host/core split**
   - Move `ecucEditorProvider`, `ecucEdit`, `ecucStructureEdit`, `diffPanel`, `compareSelection` to `src/host/`.
   - Move pure `nodeId`, `navigation`, `renderRows`, `diffModel`, labels to `src/core/`.
   - Update every import and the tests under `test/extension`, `test/core`.

7. **Cleanup and docs**
   - Delete empty old directories.
   - Update `directory-structure.md`, component guidelines, README/CHANGELOG if user-facing.
   - Full gates and boot check.

## Validation

```bash
npm run check-types
npm run lint
npm test
npm run package
```

Manual: open editor and diff on `D:\workspace\sample\arxml`; scroll both; verify single vertical bar, synchronized panes, 3px split and correct guides.

## Review gates

- Gate A: pending fixes stable.
- Gate B: skeleton/render moves type-check and tests stay green.
- Gate C: DocumentTree + editor composition works identically.
- Gate D: diff composition works identically with two virtual panes.
- Gate E: host/core split has no webview→vscode import.
- Gate F: full suite + package boot check.

## Rollback

One commit per stage. Revert the stage to restore the previous paths; behavior and payloads are unchanged.
