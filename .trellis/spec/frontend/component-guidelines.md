# Component Guidelines

This repository has no web framework. The ECUC editor is one inlined HTML page produced by
`renderHtml`, with plain CSS and plain script; the tree region is produced by `renderTree`. The
conventions below are the ones the code and tests already depend on.

## Shell vs swapped region

```
body (column)
  .toolbar                        survives a re-scan
  #content (row)
    #main (flex: 1; overflow: auto)   ← the swapped region; #tree + #empty live here
    #inspector (aside)                survives a re-scan
```

- `#main` is the **scroll container**. `reRenderTree` reads `main.scrollTop` before the `innerHTML`
  swap and writes it back after every other step; moving the scroll container silently makes that a
  no-op.
- Anything that must survive a re-scan — the toolbar, the details inspector, the details toggle —
  lives outside `#main`. The filter's empty state belongs inside `renderTree` because it describes
  the filtered tree; it is looked up fresh after each swap.
- The provider's single refresh path is `main.innerHTML = tree` plus `reRenderTree`'s seven hooks.
  Do not add a second path for one change.

## Event ownership

The value widget (`ecucValueEditor.ts`) is emitted **before** the filter and the tree. Its listeners
are the first document `click`/`keydown` listeners and claim their events with
`stopImmediatePropagation`:

```text
value widget click/key  →  filter delegated clear  →  tree click/key
```

Order is load-bearing, not stylistic. The filter's delegated `#empty-clear` click is inert for tree
targets; the tree's click handler selects/toggles/follows. One interaction, one effect: the twisty
toggles without moving the selection, a follow follows, everything else selects.

## DOM contracts

- **`.value` is a direct child of `.row`.** The widget (`:scope > .row > .value`), `highlightableSpans`
  and `editing.test.ts` depend on it. A wrapper cell breaks the widget.
- The row is a grid: `12px 12px 26ch minmax(0, 1fr)`. The label track is a **fixed** `26ch`; a
  per-row `fr` track would size to content and start values at a different x on every row. A
  module/container row has no value, so `.row.no-value .label` spans both tracks.
- Secondary fields live in `.row-meta`, a second line spanning the label and value tracks. It is not
  `.meta` — that is the schema/package container. The filter's `highlightableSpans` reaches
  `.row-meta .short`.
- `item()` writes the inspector's data: `data-definition-ref`, `data-short-name`, `data-value`
  (parameters), `data-target` (references), and the six source-range attributes. `LineIndex` is
  0-based like a VS Code `Position`; the inspector adds one for display. The inspector builds text
  nodes, never `innerHTML` from model text.
- Long labels/values/metadata ellipsize; the clipped value's `title` carries the full value. The
  node's `title` remains the full `DEFINITION-REF` hover contract.

## State

- The webview owns: `selectedId`, the collapsed id set, the scroll position, type-ahead, the open
  value edit, and the details-panel visibility. The host owns: the panel map, the selection map, and
  a pending selection.
- A re-scan replaces the tree markup but not the shell. The host payload carries `selectedId`; the
  page adopts a host-rendered `aria-selected` on first paint so a source→editor open fills the
  details panel immediately.
- The details visibility is persisted through `acquireVsCodeApi().getState()/setState()` (validated
  as a non-array object; hide only on `=== true`). The browser harness stubs the same API with
  `localStorage` so the reload path is observable.
- The pure state helpers (`pruneCollapsed`, `toggleCollapsed`, `collapsedIdsFor`, `moveTarget`,
  `reRenderTree`) are real functions serialized into the page with `toString()`. The tests extract
  and drive the page's copy; do not create a second implementation.

## Theme and accessibility

- Every colour is a `--vscode-*` variable; a literal may appear only as a fallback inside `var(...)`.
  The indent-guide fallback `#80808040` is the only literal in the stylesheet. No asset file; glyphs
  and the twisty are inline SVG under `default-src 'none'`.
- Token colours are for the normal background. On a selected row they can fall below 3:1 (the light
  theme's green value was 1.33:1 on the blue selection), so selected rows use
  `--vscode-list-activeSelectionForeground` (and the inactive equivalent when focus is outside).
- The tree exposes real `tree`/`treeitem`/`group` roles, `aria-expanded`, `aria-selected`,
  `aria-posinset`/`aria-setsize`, a roving `tabindex`, and Home/End/PageUp/PageDown. The inspector is
  a `region`, not a live region; selecting a node is already announced by the tree.

## Preview harness

`npm run preview:ecuc` serves the **production** `renderHtml` output on `127.0.0.1` with a stubbed
`acquireVsCodeApi`, theme presets and a preview panel. `npm run preview:check` asserts each wrapper
contains the exact production `renderTree` output, the stub, the inspector, the empty state and a
theme variable. The harness is dev-only, outside `src/`, and never imported by the extension.

It is not a VS Code webview: it cannot prove VS Code's own theme resolution, tab/focus behaviour or
host clipboard permissions. Label its results as harness-observed; the Extension Development Host
remains the acceptance environment.

## Common mistakes

| Mistake | Why it fails |
|---|---|
| A second renderer or copied markup for previews | It diverges from the product; wrap `renderHtml` instead |
| Putting `.value` behind a wrapper for a grid | Breaks `:scope > .row > .value` in the widget and filter |
| Using `1fr` for the label column per row | Values no longer align across rows |
| Moving the scroll container out of `#main` | `reRenderTree`'s scroll capture/restore becomes a no-op |
| Reordering the value widget after the tree | The tree can claim an event the widget needed |
| `innerHTML` with a model value | The value is text, not markup; use `textContent` |
| Calling a browser harness run a webview pass | The variables and host are stubbed; the real host still needs a check |
