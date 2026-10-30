# Hex Scope diff reference

Source: `D:\workspace\vscode-hex-scope` (read-only reference, a sibling extension by the same
publisher). Its domain is bytes, not ECUC nodes, but the entry-point, panel and refresh patterns
transfer directly. Anchors are from that repository at the time of this research (2026-10-29).

## Entry points and menu model

- `package.json` contributes one submenu `hexScope.actions` with label `HexScope` and attaches it
  to `explorer/context`, `editor/title`, `editor/title/context` and `editor/context`.
- The editor entry is suppressed for the custom editor:
  `(resourceLangId …) && activeCustomEditorId != 'hexScope.hexEditor'`
  (`package.json`, `contributes.menus["editor/context"]`).
- Compare flow has three commands:
  - `hexScope.selectAsFirst` — stash the clicked file as left side.
  - `hexScope.compareToStaged` — stash on the left, clicked file on the right; enabled only when
    `hexScope.hasCompareSelection` is set.
  - `hexScope.compareSelected` — Explorer double-selection (`listDoubleSelection`), clicked file
    left, other file right.
- `src/diff/compareSelection.ts`: a session-only `CompareSelectionStore` plus the
  `hexScope.hasCompareSelection` context key. It is not persisted.

## Panel lifecycle

- `src/diff/diffEditorPanel.ts:47` `DiffEditorPanel` uses
  `vscode.window.createWebviewPanel(viewType, title, ViewColumn.Active, { enableScripts: true,
  retainContextWhenHidden: true, localResourceRoots: [context.extensionUri] })`.
- `panel.webview.html = diffHtml(...)` renders a small shell with a nonce, a loading card, and one
  bundled script (`dist/diffViewer.js`) and stylesheet.
- The webview starts the exchange with `{ type: 'ready' }`; only then does the host load data
  (`diffEditorPanel.ts:285` `loadDiff`). This is the same handshake the ECUC editor already uses
  for its boot watchdog.
- The host posts typed messages: `diffInit`, `diffProgress`, `diffError`, `diffExternalChange`,
  `diffExternalChangeError` (`src/diffProtocol.ts:20`). The webview posts control messages
  (`ready`, `copyText`, …).
- External changes are watched per side with a debounced reload
  (`diffEditorPanel.ts:23` `RELOAD_DEBOUNCE_MS = 200`); a self-write horizon suppresses echo
  events. The ECUC diff will read through `openTextDocument` and listen to
  `onDidChangeTextDocument` instead, which also covers unsaved edits.
- Every subscription is attached to a `DisposableStore`; the panel disposal disposes them
  (`diffEditorPanel.ts:67`).

## Diff model and webview

- `src/core/diff.ts:153` computes an address-keyed diff and emits `runs` plus a `summary`
  (`changed` / `added` / `removed`). It is pure and has no `vscode` import.
- `src/webview/diff/diffModel.ts:78` builds one shared row list for both panes (union of mapped
  rows) so a row is aligned across sides; `diffClassForSide` applies `diff-chg` / `diff-add` /
  `diff-del` only to the side that owns the change.
- The webview is one grid with shared scrolling, not two independently scrolled trees. This is the
  layout the ECUC diff should copy, with an ECUC row in each cell.
- The webview owns virtual scrolling and only builds the viewport window; the host never sends
  per-row DOM.
- `src/core/diffLabels.ts:14` disambiguates two files with the same basename by the shortest
  trailing path suffix; the panel title joins the labels with `↔`.

## What to reuse and what to change for ARXML

Reuse:
- The submenu + compare-selection + three-command entry model.
- The `ready` handshake, typed message protocol, debounced external refresh, one shared aligned
  row list, changes-only navigation, and panel lifecycle/disposal.
- The disambiguated title rule.

Change:
- The comparison key is the ECUC node identity, not a memory address. `buildRows` already gives
  each node a path-based `id` plus display fields (`src/editor/renderRows.ts`), so the diff can
  compare `EcucRow` lists and reuse the production row formatting instead of copying markup.
- Data is read from open `TextDocument`s so unsaved edits are compared; there is no byte parser,
  worker, base address, or repair path.
- The diff is read-only and must never write; Hex Scope's repair/copy paths are out of scope.
