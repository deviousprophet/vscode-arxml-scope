# Component Guidelines

This repository has no web framework. The ECUC editor is one inlined HTML page produced by
`renderHtml`, with plain CSS and plain script. The host emits a compact **row document** from
`buildRows`; the page flattens that row list and renders only a virtual window. There is no
full-tree HTML string and no second renderer.

## Shell vs virtual window

```
body (column)
  .toolbar                          survives a re-scan
  #notice
  #content (row)
    #main (flex: 1; overflow: auto)   ← the scroll container
      .document
        .meta                        schema/package header
        #tree[role=tree]             contains the top spacer, #tree-window, bottom spacer
        #empty                       filtered-empty comment
    #sidebar-resizer (6px)            survives a re-scan
    #sidebar                          Details / Conditions tab panels
      #sbp-details > #inspector > section.sb-section (Node, Value, Reference, Conditions)
      #sbp-conditions > section > #conditions-panel
    #side-tabs (28px)                 right-edge vertical tabs
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
- Anything that must survive a re-scan — the toolbar, the sidebar, the tabs, the inspector and the
  Conditions panel — lives outside the rows. The filter's empty state lives beside `#tree` because it
  describes the filtered list.
- There is one Document presentation. There is no view toggle, no `view` state, no Tree CSS/probes/
  glyphs and no second refresh path.

## Sidebar shell

- The right side is a Hex Scope-style sidebar: a 28px vertical tab strip (**Details**, **Conditions**)
  at the far right, a resizable panel area, and one visible tab panel at a time. Details is the
  default. There is no toolbar Details/Conditions toggle and no second panel surface.
- `#inspector` remains the Details panel root. It is split into four stable section bodies (Node,
  Value, Reference, Conditions & annotations); `updateInspector` clears and rewrites the bodies only,
  never the section headers. The details editor owns its inputs in the Value/Node bodies.
- Every section is a pane: 22px header (`role=button`, `aria-expanded`, `aria-controls`), chevron,
  independent scrolling body (`role=region`), and a 6px `role=separator` sash to the next section.
  Sashes support drag, ArrowUp/ArrowDown, double-click reset and are disabled next to a collapsed
  pane. Collapse/expand animates 150ms; resize/layout is instant; reduced motion disables animation.
- Pane sizing: `HEADER_H=22`, `MIN_PANE=82`, `SASH_H=6`; saved user sizes first, fresh sections
  share the remainder, the last absorbs rounding, a single expanded section fills the panel.
- The layout state (`tab`, `sidebarWidth`, `panes`, `collapsed`) is persisted through
  `acquireVsCodeApi().getState()/setState()`. A re-scan never resets it. The old `inspectorHidden`
  state is ignored.
- The shared control system is `.sb-btn-primary`, `.sb-btn-secondary`, `.sb-btn-add`,
  `.sb-btn-danger`, `.nav-btn` and `.act-btn`. Toolbar, details actions, Conditions actions and the
  Filter/Search fields use those classes; do not add a one-off button style. Fields use `.filter` /
  `.search-input` (26px, input tokens, 3px radius) and the native search cancel is suppressed.

## Event ownership

The details editor (`ecucDetailsEditor.ts`) is emitted **before** the page script. Its controls live
in the details panel, outside `#tree`, and each owns its own `Enter`/`Escape`/`Tab` keys:

```text
details control keys  →  details editor commit/cancel/move
page row click        →  select / twisty / value-click opens details
search input keys     →  Enter/Shift+Enter next/previous, Escape clears, Ctrl+F focuses
page key handler      →  navigation / F2/Enter opens details / F3 while search is active / type-ahead
```

The page's `onRowClick` handles the delegated `#empty-clear` action and the row interactions. One
interaction, one effect: the twisty toggles without moving selection, a reference target is plain
text in the Document, clicking `=`/label selects only, and clicking a parameter's `.value-text`
selects and opens the details editor. Reference follow is the details **Jump to target** action.
The inline chevron (`twistyIcon`) is one shared row primitive in `rowViewScript()`; the editor and
diff pages must not fork it.

## DOM contracts

- **The filter's only clear control is the custom `#filter-clear` button.** The input stays
  `type="search"` for its searchbox role and native Escape behaviour, but Chromium also paints a
  native `::-webkit-search-cancel-button`. The page suppresses
  `::-webkit-search-cancel-button` and `::-webkit-search-decoration` in the nonce-carrying `STYLE`;
  removing that rule reintroduces a second X beside the custom button. `#filter-clear` starts
  `hidden` and is toggled by the page script.
- **Filter hides; Search jumps.** The Filter field narrows the tree; the Search field never hides a
  row. `searchRows(rows, query, filterResult?.visible)` is the single candidate rule: an active
  filter restricts candidates to its displayed rows, no filter searches the whole tree, and collapse
  does not remove a candidate. A jump expands ancestors, scrolls and selects the row but keeps focus
  in the Search input. Search highlights override filter marks while the query is non-blank; clearing
  restores filter marks. Do not add a second find bar or let Search write the filter query/result.
- **Conditions actions follow the shared hierarchy.** Rows are data-backed (`data-name`,
  `data-value`, `data-auto`, `data-editing`); Edit/Remove are compact `.act-btn` actions, Save is
  `.sb-btn-primary`, Cancel/Clear are `.sb-btn-secondary`, Add is `.sb-btn-add`. Scanned constants
  (names referenced by the current document) are read-only and have no Remove; only manual rows can
  be removed. Clear values empties the committed `data-value` values and keeps the rows. The
  `unknown` badge is visible only for an empty committed value outside edit mode. Do not use the
  transparent `.tool` treatment for a primary action; hover-only affordances are not discoverable.
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
- Empty containers carry `data-empty` and show a muted `{ }` marker; they remain leaves with no
  fold control, so they cannot be mistaken for a parameter.
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
- The details control is `<input class="details-value">` for numeric/text types and a
  `<select class="details-value">` for Boolean, with `aria-label`, `aria-invalid` on refusal and a
  `.details-value-error` live status. A container row instead shows editable `Short name`
  (`id="details-short-name"`, `data-field="shortName"`) and `Definition`
  (`id="details-definition-ref"`, `data-field="definitionRef"`) text inputs; its read-only
  `Definition`/`Short name` rows are not emitted, so a fact is never shown twice. Every control
  commits through `{ type:'edit', nodeId, value }`, and the two container controls add
  `field: 'shortName' | 'definitionRef'`. The panel shows the AUTOSAR type and integer
  Decimal/Hexadecimal/Binary formats.

## State

- The webview owns: `selectedId`, `focusId`, the collapsed id set, the filter query/result, the
  viewport range/scroll position, type-ahead, the details edit, the sidebar tab/width/pane state and
  (after the Find child) the search state. The host owns: the panel map, the selection map and a
  pending selection.
- A re-scan sends `{ type: 'model', rows, selectedId }`. `setRows` rebuilds the row maps, prunes the
  collapsed set, preserves query/scroll where possible, recomputes the selected branch and re-renders
  the window. `reconcileRowState` is the serialized policy; `resolveFocusId` restores focus by id
  when the row remains rendered. The old `reRenderTree` DOM swap is gone.
- The initial row payload carries the host selection; `prepareFocus` expands its ancestors if
  needed, scrolls it into the rendered window and fills the inspector.
- Only layout state is persisted through `acquireVsCodeApi().getState()/setState()`: `tab`,
  `sidebarWidth`, `panes` and `collapsed`. A missing or invalid state falls back to Details, 360px
  and default section heights; a legacy `inspectorHidden` is ignored and never written back. The
  reload round trip is observed in the Extension Development Host.
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

## Manual previews

The in-repo preview harness (`preview:ecuc`, `preview:check` and `scripts/`) has been removed, together
with the sample generator and benchmark. The production `renderHtml` page is therefore observed in the
Extension Development Host: open a fixture or a local `.arxml` in the ECUC editor and inspect the real
webview.

The host is not a repeatable check: its observations cannot run in CI, so record them as
host-observed with the file and the steps that produced them. If a preview harness is reintroduced, it
must wrap the production renderer — a second renderer is a test that agrees with itself.

The Development Host remains the acceptance environment: it can prove VS Code's own theme/font
resolution, tab/focus behaviour and accessibility-tree exposure, which no string assertion can.

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
| Making every reference show a jump action | Unresolved targets must not get the details button; the followability test fails |
| Hiding the Collapse/Expand labels at normal widths | The labelled-control test fails |
| Inserting an editor into `.value` | The Document is read-only; the `.value` direct-child/test contract and click semantics fail |
| Adding a Source block or copy action | The details panel exposes Jump/Reveal only; provider copy code was deleted |
| Moving the scroll container out of `#main` | The virtual range and scroll position become a no-op |
| Using `#tree-window` as the rows offset | It moves with the top spacer, so a window update looks like scrolling to the top |
| Setting spacer heights with a style attribute | The CSP blocks inline styles; update the nonce-carrying `#virtual-style` sheet |
| Using an inline `style` instead of `data-level` | The CSP blocks style attributes and the depth CSS cannot follow |
| `innerHTML` with a model value | The value is text, not markup; use `textContent` |
| Reading the inspector from the rendered row | An offscreen selection has no rendered row; use `rowById` |
| Calling a string assertion or a test-host render a webview pass | Neither is a VS Code webview; the Extension Development Host still needs a check |

## Semantic diff surface

`src/diff/**` is a second webview, not a second renderer. Its invariants:

- `diffModel.ts` is pure (no `vscode`); it owns projection, matching, status, merged order,
  summary and the page helpers. The panel only reads documents, scans and posts.
- Both pages inject `rowViewScript()`; `valueSpan`/`metaSpan`/`appendHighlighted` bodies are
  byte-identical (tested). Do not fork a row primitive into the diff page.
- `diffPage.ts` reuses `virtualScrollScript()`; only the viewport window is in the DOM and the
  spacer heights come from `calcRowOffset`/`calcTotalHeight`. The list offset comes from
  `#diff-list`'s content edge, not `#diff-window`.
- `DiffCell.range` is injected from the host's `buildNodeIndex`; `EcucRow` still carries no
  source positions. Reveal forces `mode: 'beside'` so the diff tab survives `revealMode: replace`.
- A paired row uses the left id as its page key; an added row uses `right:` + its right id, so a
  duplicate pairing that shifts an ordinal cannot hand an added row the key a paired row already
  uses (its subtree embeds that id too). `parentKey` is the merged parent's key, never copied from
  either side.
- Same-named sibling groups pair by exact compared content first, then by the looser sort identity,
  before ordinal ids, because a declaration swap puts different values at the same ordinal. Equal-size
  groups therefore compare equal, even when the duplicates differ only in a condition or DEST, and a
  changed duplicate still lands on one row instead of add + remove. The base-id one-to-one fallback
  remains for the single-leftover case. The base key removes the row's own ordinal **and** an
  embedded parent container ordinal, so reordered duplicate containers keep their parameters and
  references paired at every depth.
- The diff is read-only: no `WorkspaceEdit`, `writeFile`, `applyEdit`, repair or derived file.
  Refresh is a full re-scan after a 150 ms debounce; the page keeps filter, changes-only,
  collapse, selection and scroll.
- The manifest adds the three commands to the existing `arxmlScope.actions` submenu with
  `explorerViewletFocus`/`listDoubleSelection` guards; there is no flat `editor/context` diff entry.
