# Component Guidelines

This repository has no web framework. The ECUC editor is one inlined HTML page produced by
`renderHtml`, with plain CSS and plain script. The host emits a compact **row document** from
`buildRows`; the page flattens that row list and renders only a virtual window. There is no
full-tree HTML string and no second renderer.

## Shell vs virtual window

```
body (column)
  .toolbar                        survives a re-scan
  #content (row)
    #main (flex: 1; overflow: auto)   ← the scroll container
      .document
        .meta                        schema/package header
        #tree[role=tree]             contains the top spacer, #tree-window, bottom spacer
        #empty                       filtered-empty comment
    #inspector (aside)                survives a re-scan
```

- `#main` is the **scroll container**. The page computes the rows-region offset from `#tree`'s
  content edge (not from `#tree-window`, which moves with the top spacer), reads `main.scrollTop`,
  and calls the pure `calcVisibleRange` math. Do not move the scroll container.
- `#tree-window` holds only the viewport rows plus a small overscan (10 rows). Top/bottom spacers
  preserve the full scroll height; their heights come from a nonce-carrying stylesheet
  (`#virtual-style`), because the CSP blocks style attributes. `overflow-anchor: none` on `#main`
  stops browser scroll anchoring from fighting the spacer swap.
- The initial rows are escaped JSON in `<script type="application/json" id="ecuc-rows">`; the page
  parses it and never evaluates model text. A re-scan posts row data, not tree markup.
- Anything that must survive a re-scan — the toolbar, the details inspector, the details toggle —
  lives outside the rows. The filter's empty state lives beside `#tree` because it describes the
  filtered list.
- Do not add a second refresh path for one change.

## Event ownership

The value widget (`ecucValueEditor.ts`) is emitted **before** the page script. Its listeners are the
first document `click`/`keydown` listeners and claim their events with `stopImmediatePropagation`:

```text
value widget click/key  →  page row click (select/twisty/follow/empty-clear)  →  page key handler
```

Order is load-bearing, not stylistic. The page's `onRowClick` handles the delegated `#empty-clear`
action and the row interactions. One interaction, one effect: the twisty toggles without moving the
selection, a follow follows, everything else selects.

## DOM contracts

- **`.value` is a direct child of `.row`.** The widget (`:scope > .row > .value`),
  `highlightableSpans` equivalents and `editing.test.ts` depend on it. A wrapper cell breaks the
  widget.
- Tree rows are a grid: `12px 12px 26ch minmax(0, 1fr)`. The label track is a **fixed** `26ch`; a
  per-row `fr` track would size to content and start values at a different x on every row. A
  module/container row has no value, so `.row.no-value .label` spans both tracks.
- Document rows are a single flex line with `gap: 1ch`, no border, no fixed label column. Depth is
  `data-level` + generated attribute CSS (`margin-left` stays at `-gut` so the tint/rail cover the
  gutter; `padding-left` carries the indent). Never use a style attribute for depth.
- Secondary fields live in `.row-meta`, the second line in Tree view and inline metadata in
  Document view. It is not `.meta` — that is the schema/package container. The filter highlights
  `.row-meta .short`, `.label` and `.value .value-text`.
- The row builder writes the inspector's primary identity as data: `data-node-id`, `data-kind`,
  `data-definition-ref`, `data-short-name`, `data-value` (parameters), `data-target` (references)
  and the four line/column attributes on `.node`. `.row` carries the 1-based `data-line` gutter
  line. `LineIndex` is 0-based like a VS Code `Position`; the inspector adds one for display;
  `.row` `data-line` is the 1-based source line.
- The details inspector reads the selected **row from the row map**, not from a rendered element, so
  an offscreen selection still shows its values. It builds text nodes, never `innerHTML` from model
  text.
- Long labels/values/metadata ellipsize in Tree view; the clipped value's `title` carries the full
  value. The node's `title` remains the full `DEFINITION-REF` hover contract.
- **Document view is CSS over the same rows, not a second renderer.** `renderHtml` writes
  `data-view="document"` on `<body>`; every document selector is scoped under
  `body[data-view="document"]`, so switching back to Tree view is one attribute change. Do not
  create a second tree, parse `.artext`, or run the legacy `mmx` binary from the extension.
- Rows are built with `document.createElement` / `textContent`; the only `innerHTML`-like SVG is
  created with `createElementNS`. Brace rows are `aria-hidden`; the Document line-number gutter is
  `data-line` + `.row::before`.

## State

- The webview owns: `selectedId`, `focusId`, the collapsed id set, the filter query/result, the
  viewport range/scroll position, type-ahead, the open value edit, the view mode and the details
  visibility. The host owns: the panel map, the selection map, and a pending selection.
- A re-scan sends `{ type: 'model', rows, digits, selectedId }`. `setRows` rebuilds the
  row maps, prunes the collapsed set, preserves query/view/scroll where possible and re-renders the
  window. `reconcileRowState` is the serialized policy; `resolveFocusId` restores focus by id when
  the row remains rendered. The old `reRenderTree` DOM swap is gone.
- The initial row payload carries the host selection; `prepareFocus` adopts it, scrolls it into the
  rendered window and fills the inspector.
- The view mode and details visibility are persisted together through
  `acquireVsCodeApi().getState()/setState()` (validated as a non-array object; `view` accepts only
  `document`/`tree`, missing/invalid falls back to `document`, and the inspector hides only on
  `=== true`, default `true`). The first paint is already Document with the inspector hidden; the
  page script applies a saved Tree view or a shown inspector immediately. The browser harness stubs
  the same API with `localStorage` and `?view=document|tree` seeds the state for captures.
- The pure state helpers (`pruneCollapsed`, `toggleCollapsed`, `collapsedIdsFor`, `moveTarget`,
  `reconcileRowState`, `resolveFocusId`, `inspectorFields`) are real functions serialized into the
  page with `toString()`. The tests extract and drive the page's copy; do not create a second
  implementation.
- The filter uses `filterRows`/`flattenRows` and `createFilterDebouncer`; a stale generation cannot
  overwrite a newer query. The collapsed set is read, never written, by the filter; clearing the
  query restores it.

## Theme and accessibility

- Every colour is a `--vscode-*` variable; a literal may appear only as a fallback inside `var(...)`.
  The indent-guide fallback `#80808040` is the only literal in the stylesheet. No asset file; glyphs
  and the twisty are inline SVG under `default-src 'none'`.
- **Value type is data.** A parameter's value span carries `data-value-kind="numeric|textual|boolean"`;
  the CSS maps it to `--tok-number`/`--tok-string`/`--tok-keyword`. Short names use `--tok-string`.
  The token names mirror the reference branch's `artext.tmLanguage.json` scopes (strings, numbers,
  booleans, variables); that branch is a grammar, not a palette to copy. In Tree view the kinds keep
  their `symbolIcon-module/namespace/field/reference` accents, glyphs, chips and dotted values.
- **Selection never recolours syntax.** Tree and Document selection use the `--sel-bg`/
  `--sel-bg-focus` tint and a 2px `--rail` focus edge. Document keeps the token colours on the
  selected line and brightens the source line number. High contrast uses outlines, not fills.
- The flat tree uses `role="tree"` with direct `role="treeitem"` children (the window/spacers are
  `role="presentation"`/`aria-hidden`), `aria-level`, `aria-posinset`, `aria-setsize`,
  `aria-expanded`, `aria-selected` and a roving `tabindex`. This is a valid flat tree without
  `role="group"` wrappers. The accessibility tree exposes the rendered window, not every offscreen
  row; keyboard navigation renders the target before focusing it, and the inspector is a `region`,
  not a live region. Record the window limitation rather than claiming full-tree exposure.
- The Tree row heights are deterministic: `--tree-row-h` / `--tree-row-h-meta`, with a one-line
  `.row-meta`; Document node/brace rows use `--ecuc-lh` plus a module gap attribute. The CSS and the
  page's `heightFn` must agree.

## Preview harness

`npm run preview:ecuc` serves the **production** `renderHtml` output on `127.0.0.1` with a stubbed
`acquireVsCodeApi`, theme presets and a preview panel. `npm run preview:check` asserts each wrapper
contains the exact production row JSON and virtual shell, the stub, the inspector, the empty state
and a theme variable. `?view=document` or `?view=tree` seeds the saved view state, and `?chrome=0`
produces a clean page for captures. The harness is dev-only, outside `src/`, and never imported by
the extension.

It is not a VS Code webview: it cannot prove VS Code's own theme resolution, tab/focus behaviour or
host clipboard permissions. Label its results as harness-observed; the Extension Development Host
remains the acceptance environment.

## Common mistakes

| Mistake | Why it fails |
|---|---|
| Building the full row DOM instead of the virtual window | The lag this task removes comes back; the window tests and DOM count fail |
| Putting the row builder behind a second renderer or copied markup | It diverges from the product; wrap `renderHtml` instead |
| Moving the scroll container out of `#main` | The virtual range and scroll position become a no-op |
| Using `#tree-window` as the rows offset | It moves with the top spacer, so a window update looks like scrolling to the top |
| Setting spacer heights with a style attribute | The CSP blocks inline styles; update the nonce-carrying `#virtual-style` sheet |
| Using an inline `style` instead of `data-level` | The CSP blocks style attributes and the depth CSS cannot follow |
| Putting `.value` behind a wrapper for a grid | Breaks `:scope > .row > .value` in the widget and filter |
| Reordering the value widget after the tree | The tree can claim an event the widget needed |
| `innerHTML` with a model value | The value is text, not markup; use `textContent` |
| Reading the inspector from the rendered row | An offscreen selection has no rendered row; use `rowById` |
| Calling a browser harness run a webview pass | The variables and host are stubbed; the real host still needs a check |
