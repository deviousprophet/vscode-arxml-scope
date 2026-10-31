# Directory Structure

## Layout

```
src/
  extension.ts        activation, registrations
  commands.ts         command handlers and the activation gate
  host/               VS Code effects. MAY import `vscode`.
    ecucEditorProvider.ts   provider: gate, scan, build rows, wire, re-scan
    ecucEdit.ts             the edit record, region resolution, applyEdit
    ecucStructureEdit.ts    delete/duplicate plans and one-edit structure writes
    diffPanel.ts            the WebviewPanel lifecycle, refresh and reveal
    compareSelection.ts     the session-only first-file stash
    conditionValues.ts      SW-SYSCOND entries and the workspaceState store
    navigation.ts           node <-> source range, reference following
    bootWatchdog.ts         the boot timeout
    webviewShell.ts         the static editor/diff HTML shells and CSP
  core/               pure logic. NO `vscode` imports and no DOM.
    ecuc/             detect.ts  scanner.ts  model.ts  conditionEntry.ts  order.ts  resolve.ts
                      validate.ts  syscond.ts  nodeId.ts  renderRows.ts  haystack.ts
    text/             offsets.ts (line/offset index)
    diff/             diffModel.ts (matching/status/merged order, pure)
                      wordDiff.ts (token-level comparison, pure)
  webview/            browser-only page code. NO `vscode` imports.
    editorViewer.ts         editor composition root: row model, selection, search, message bridge
    diffViewer.ts           diff composition root: diff document, view mode, search, message bridge
    components/
      documentTree/         documentTreeView.ts  documentTreeState.ts  documentRows.ts  documentTree.css
      diffView/             diffView.ts  diffViewRender.ts  diffView.css
      toolbar/              toolbar.ts  toolbar.css
      searchBar/            searchBar.ts  searchBar.css
      sidebar/              sidebar.ts  sidebar.css
        detailsPanel/       detailsPanel.ts  detailsPanel.css
        conditionsPanel/    conditionsPanel.ts  conditionsPanel.css
      contextMenu/          contextMenu.ts  contextMenu.css
      detailsEditor/        detailsEditor.ts  detailsEditor.css
    render/                 virtualScroll.ts  rowView.ts  rowSearch.ts  treeQuery.ts
                            dom.ts  pageError.ts
    styles/                 tokens.css  base.css
  test/
    core/               pure suites (ecuc, text, diff model, word diff)
    webview/
      components/       <component-name>.test.ts (flat, one per component)
      page/             full-page jsdom suites (static shell + compiled page module)
      render/           shared render helper suites
    extension/          host/provider/command integration suites
    benchmarks/         runBenchmark.ts plus *Benchmark.ts suites (Node, esbuild at run time)
    fixtures/           synthetic input fixtures (pinned `-text`)
    expected/           hand-authored expected models
    data/               gitignored: real files for local experimentation. Never commit.
```

Build outputs, all gitignored: `dist/` (esbuild bundles: `extension.js`, `editorViewer.js`/`.css`,
`diffViewer.js`/`.css`) and `out/` (`tsc` output used by the tests; `src/test/webview/cssImportHook.ts`
teaches `require()` to accept `.css` and mirrors the stylesheets into `out/` before the suites load).

## The layering rule

**`src/core/**` must not import `vscode` or `src/webview/**`.** Dependencies point one way:

```
extension.ts / commands.ts / host/**  ──▶  core/**  ──▶  (nothing browser-specific)
host/** / webview/**                   ──▶  webview/** component contracts
webview/**                             ──▶  core/**
```

`core/` is a pure library over text: detection, scanning, the information model, ordering,
resolution, validation, the row document and the offset index. Keeping `vscode` and DOM out of it is
what lets the same code serve a workspace index or a language server later, and it makes the core
testable without a running editor.

`webview/` is browser-only. It may import `core/` and its own components; it must never import
`vscode` or a `host/` module. Shared protocol shapes come from `webviewProtocol.ts` /
`diffProtocol.ts` as `import type`, so the page bundle carries no host runtime.

## Where new code goes

| Adding… | Goes in |
|---|---|
| Parsing, ordering, validation, anything over text | `src/core/` |
| A row/document model rule | `src/core/ecuc/` |
| A diff matching/status/order rule | `src/core/diff/diffModel.ts` |
| A document, panel, command or setting effect | `src/host/` or `src/commands.ts` |
| A reusable UI unit with markup, input behaviour and styles | `src/webview/components/<Name>/` |
| A page shell / provider bridge | `src/webview/editorViewer.ts` or `diffViewer.ts` |
| A shared page helper (scroll, rows, search, escaping) | `src/webview/render/` |
| Shared tokens, reset or layout boxes | `src/webview/styles/` |
| A synthetic fixture for a core suite | `src/test/fixtures/` |
| A large-file benchmark | `src/test/benchmarks/<name>Benchmark.ts` |
| A real file you want to try locally | `src/test/data/` (gitignored; create it locally) |
