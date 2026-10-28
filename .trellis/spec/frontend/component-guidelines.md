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
  parses it and never evaluates model text. A re-scan posts `{ type: 'model', rows, selectedId }`,
  not tree markup and no `digits`.
- Anything that must survive a re-scan — the toolbar, the details inspector, the details toggle —
  lives outside the rows. The filter's empty state lives beside `#tree` because it describes the
  filtered list.
- There is one Document presentation. There is no view toggle, no `view` state, no Tree CSS/probes/
  glyphs and no second refresh path.

## Event ownership

The details editor (`ecucDetailsEditor.ts`) is emitted **before** the page script. Its value input
lives in the details panel, outside `#tree`, and owns its own `Enter`/`Escape`/`Tab` keys:

```text
details input keys  →  details editor commit/cancel/move
page row click      →  select / twisty / follow / value-click opens details
page key handler    →  navigation / F2/Enter opens details / type-ahead
```

The page's `onRowClick` handles the delegated `#empty-clear` action and the row interactions. One
interaction, one effect: the twisty toggles without moving selection, a reference target follows,
clicking `=`/label selects only, and clicking a parameter's `.value-text` selects and opens the
details editor.

## DOM contracts

- **`.value` is a direct child of `.row`.** The filter, `valueSpan` and tests depend on it. No input
  is inserted into `.value`; the details input is separate.
- Document rows are a single flex line with `gap: 1ch`, no border and no fixed label column. Depth is
  `data-level` + generated attribute CSS
  (`padding-left: calc(var(--content-pad) + var(--indent) * n)`), where `--content-pad` is the 26px
  fold gutter plus `--doc-pad`. Never use a style attribute for depth.
- The fold gutter is a fixed 26px column at the far left of every row. The 16px Codicon outline
  chevron is absolutely positioned 2px from the row's left edge and spans the full row height; leaves
  reserve the gutter but have no twisty child. Expanded chevrons are hover/focus-only; collapsed
  chevrons stay visible. Brace rows use the same indentation as labels (no extra fold offset).
- Secondary fields live in `.row-meta`, inline after the value in Document. It is not `.meta` — that
  is the schema/package container. The filter highlights `.row-meta .short`, `.label` and
  `.value .value-text`.
- The row builder writes the inspector's primary identity as data: `data-node-id`, `data-kind`,
  `data-definition-ref`, `data-short-name`, `data-value` (parameters), `data-target` (references).
  There are no source line/column attributes and no `data-ln-digits`.
- Each container draws bracket guides: one absolute `.guide` span per open ancestor per rendered row,
  with `data-level`/`data-container-id`. Guides run from opening to closing brace, fade at rest and
  activate on hover. Selection uses `data-subtree` on descendants and a stronger parameter row; it
  never moves the guides. The selected-branch marker is gone.
- The details inspector reads the selected **row from the row map**, not from a rendered element, so
  an offscreen selection still shows its values. It builds text nodes, never `innerHTML` from model
  text.
- Long labels/values/metadata use `white-space: pre` and horizontal scroll. The node's `title` remains
  the full `DEFINITION-REF`.
- Rows are built with `document.createElement` / `textContent`; the only `innerHTML`-like SVG is the
  inline twisty created with `createElementNS`. Brace rows are `aria-hidden`.
- The details value input is `<input class="details-value">`, with `aria-label`, `aria-invalid` on
  refusal and a `.details-value-error` live status. It commits through the existing
  `{ type:'edit', nodeId, value }` message.

## State

- The webview owns: `selectedId`, `focusId`, the collapsed id set, the filter query/result, the
  viewport range/scroll position, type-ahead, the details edit and the details visibility. The host
  owns: the panel map, the selection map and a pending selection.
- A re-scan sends `{ type: 'model', rows, selectedId }`. `setRows` rebuilds the row maps, prunes the
  collapsed set, preserves query/scroll where possible, recomputes the selected branch and re-renders
  the window. `reconcileRowState` is the serialized policy; `resolveFocusId` restores focus by id
  when the row remains rendered. The old `reRenderTree` DOM swap is gone.
- The initial row payload carries the host selection; `prepareFocus` expands its ancestors if
  needed, scrolls it into the rendered window and fills the inspector.
- Only the details visibility is persisted through `acquireVsCodeApi().getState()/setState()`
  (validated as a non-array object; missing/invalid hides the inspector `=== true`). The first paint
  is Document with the inspector hidden; an old saved `view` is ignored. The browser harness stubs
  the same API with `localStorage`.
- The pure state helpers (`pruneCollapsed`, `toggleCollapsed`, `collapsedIdsFor`, `moveTarget`,
  `reconcileRowState`, `resolveFocusId`, `subtreeRowIds`, `guidesFor`, `inspectorFields`) are real functions
  serialized into the page with `toString()`. The tests extract and drive the page's copy; do not
  create a second implementation.
- The filter uses `filterRows`/`flattenRows` and `createFilterDebouncer`; a stale generation cannot
  overwrite a newer query. The collapsed set is read, never written, by the filter; clearing the
  query restores it.

## Theme and accessibility

- Every colour is a `--vscode-*` variable; a literal may appear only as a fallback inside `var(...)`,
  except the fixed dark container accent `--container-accent: #4EC9B0` (some themes resolve the
  symbol-icon namespace to the regular foreground). High contrast/forced colors override the accent
  to the editor foreground. The bracket-guide fallback `#80808040` and the yellow reference fallback
  are the other literals in the stylesheet. No asset file; the twisty is inline SVG under
  `default-src 'none'`.
- **Value type is data.** A parameter's value span carries `data-value-kind="numeric|textual|boolean"`;
  the CSS maps it to `--tok-number`/`--tok-string`/`--tok-keyword`. Short names use `--tok-string`.
  The token names mirror the reference branch's `artext.tmLanguage.json` scopes; that branch is a
  grammar, not a palette to copy. There are no Tree glyph/chip/per-kind accent colours.
- **Selection never recolours syntax.** Document selection uses the `--sel-bg`/`--sel-bg-focus` tint
  and a 2px `--rail` focus edge; the selected container uses the visible neutral
  `--sel-container-bg`, its subtree gets the softer tint, and a selected parameter adds a 1px
  outline. High contrast uses outlines, not fills: the subtree tint becomes a dotted outline in
  HC/forced colors.
- The flat tree uses `role="tree"` with direct `role="treeitem"` children (window/spacers are
  `role="presentation"`/`aria-hidden`), `aria-level`, `aria-posinset`, `aria-setsize`,
  `aria-expanded`, `aria-selected` and a roving `tabindex`. This is a valid flat tree without
  `role="group"` wrappers. The accessibility tree exposes the rendered window, not every offscreen
  row; keyboard navigation renders the target before focusing it, and the inspector is a `region`,
  not a live region. Record the window limitation rather than claiming full-tree exposure.
- Document node/brace rows use `--ecuc-lh` plus a module gap attribute; there are no Tree row heights.
  The CSS and the page's `heightFn` must agree.

## Preview harness

`npm run preview:ecuc` serves the **production** `renderHtml` output on `127.0.0.1` with a stubbed
`acquireVsCodeApi`, theme presets and a preview panel. `npm run preview:check` asserts each wrapper
contains the exact production row JSON and Document virtual shell, the stub, the inspector, the empty
state and a theme variable. `?chrome=0` produces a clean page for captures. There is no
`?view=tree`/view seed. The harness is dev-only, outside `src/`, and never imported by the extension.

It is not a VS Code webview: it cannot prove VS Code's own theme/font resolution, tab/focus behaviour
or accessibility-tree exposure. Label its results as harness-observed; the Extension Development
Host remains the acceptance environment.

## Common mistakes

| Mistake | Why it fails |
|---|---|
| Building the full row DOM instead of the virtual window | The lag this task removes comes back; the window tests and DOM count fail |
| Putting the row builder behind a second renderer or copied markup | It diverges from the product; wrap `renderHtml` instead |
| Re-adding a Tree view toggle/CSS/glyph | The Document-only contract and tests fail; the Tree view was deliberately removed |
| Re-adding line numbers/`data-line`/`digits` | The no-gutter contract and alignment tests fail |
| Re-adding a repeating indent gradient | The bracket-guide contract fails |
| Leaking bracket guides outside their container | `guidesFor` and the `.guide` tests fail |
| Tinting rows outside the selected subtree | `subtreeRowIds`/`data-subtree` tests fail |
| Making every reference followable | Unresolved targets get a link; the same-file follow test fails |
| Hiding the Collapse/Expand labels at normal widths | The labelled-control test fails |
| Inserting an editor into `.value` | The Document is read-only; the `.value` direct-child/test contract and click semantics fail |
| Adding a Source block or copy action | The details panel exposes Reveal only; provider copy code was deleted |
| Moving the scroll container out of `#main` | The virtual range and scroll position become a no-op |
| Using `#tree-window` as the rows offset | It moves with the top spacer, so a window update looks like scrolling to the top |
| Setting spacer heights with a style attribute | The CSP blocks inline styles; update the nonce-carrying `#virtual-style` sheet |
| Using an inline `style` instead of `data-level` | The CSP blocks style attributes and the depth CSS cannot follow |
| `innerHTML` with a model value | The value is text, not markup; use `textContent` |
| Reading the inspector from the rendered row | An offscreen selection has no rendered row; use `rowById` |
| Calling a browser harness run a webview pass | The variables and host are stubbed; the real host still needs a check |
