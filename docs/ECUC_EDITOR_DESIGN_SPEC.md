# ECUC Editor Design Spec

**Status:** current for the Document-only UI (2026-10-28). Supersedes the earlier Document/Tree,
source-line gutter, inline-edit, F2-hint, Source-block and copy-action design.

**Scope:** presentation and parameter type metadata. The ordering, DOM contracts, write path and
manifest do not change. `src/core/**` changes are limited to `DEFINITION-REF DEST` capture,
type-aware validation, and removing the now-unused `hexValue` computation; there is no schema
database.

---

## 1. Direction and principles

**Direction: "quiet source, one view."** The editor is one monospace Document surface on the editor
background: indentation, braces, bracket-connected container guides, and sparse semantic colour. There is no
line-number gutter and no second Tree view. Everything interactive (fold controls, selection,
details editing, follow) is revealed by hover, focus or selection and never occupies space at rest.
Chrome shrinks to a single 26px strip in the UI font, so the eye separates "tool" from "document" by
typeface and not by boxes.

**Principles**

1. **One surface.** Everything sits on `--vscode-editor-background`. Separation is by typeface,
   hairline or spacing, never by filled boxes.
2. **Position before colour.** Hierarchy comes from indentation, braces and `key = value` structure.
   Colour marks token meaning only: keyword, string, number, boolean, variant/condition, comment.
3. **Reveal on demand.** Fold chevrons, selection and the bracket guides clarify on hover, focus or
   selection; collapsed state and read-only values are the deliberate resting exceptions.
4. **Selection never recolours syntax.** Selection is a background tint plus a 2px rail. Tokens keep
   their colours.
5. **No misleading locator.** Real source line numbers are not shown: under the default `all`
   ordering they jump around, and a display-index gutter would be a different lie. Reveal in source
   is the locator.
6. **Edit in details, not in the document.** The Document is read-only. The selected parameter's
   value field lives in the details panel.

### ARTEXT comparison

| | ARTEXT reference | ECUC editor |
|---|---|---|
| Surface | One text surface | Same |
| Line numbers | Continuous 1..N | **Removed**; no gutter |
| Hierarchy | Indentation/braces | Same, plus bracket-connected container guides |
| Values | `key = value` text | Same; read-only on the surface |
| Selection | n/a | Tinted row + 2px rail |
| Editing | n/a | Details-panel value field |
| Details | n/a | Docked panel, Reveal in source only |

## 2. Shell and layout

### 2.1 Shell

```text
+ Filter [x]  shown of total     Collapse  Expand  Details +
| document (mono, virtual, scrolls both ways)      | details (optional) |
```

- A single 26px toolbar: filter, count/status, labelled **Collapse** and **Expand** controls with
  larger 14px icons, and Details. The labels hide only at narrow widths.
- No **Document | Tree** switch and no Tree view state.
- The document scrolls inside `#main`; the details panel is a docked 260–340px column, or a bottom
  sheet at narrow widths.
- The details panel starts hidden; its visibility persists through the webview state.
- The page is one `role="tree"` virtual window; there is no second renderer.

### 2.2 Document surface

- One monospace surface, `line-height: 1.55em`, `white-space: pre`, horizontal scroll, no wrap.
- No line-number gutter, `data-line` or `data-ln-digits`.
- Geometry: `--fold-gutter: 26px` at the far left, `--content-pad: calc(var(--fold-gutter) +
  var(--doc-pad))`, `--doc-pad: 3ch` (`2.5ch` narrow) and `--indent: 4ch` (`3ch` narrow). A level-3
  row uses `padding-left: calc(var(--content-pad) + var(--indent) * 2)` (`level - 1`); brace rows use
  the same indentation, so `{`/`}` align with the row text.
- The fold gutter is fixed at the far left and is part of every row. The 16px Codicon outline
  chevron is inset 2px and spans the full row height; leaves reserve the gutter without a child.
- A container with children shows the chevron while the tree is hovered or focused; its resting
  opacity is 0, matching VS Code. A collapsed container always shows its right chevron and a
  `{ ... }` stub. An empty container ends in a muted `{ }` marker.
- One blank line between modules; braces on their own lines.
- No list bullets, per-row borders, chips, fixed label columns or vertical rules across the whole
  surface.

### 2.3 Bracket guides

- Each container draws one 1px vertical guide per nesting level, from its opening brace to its
  closing brace. The guide sits at the brace column (`--content-pad + --indent * (level - 1) + 0.5ch`).
- Nested containers add their own guide: a row inside two containers carries both segments.
- Guides are always present but faded (`opacity: .28`) at rest; hovering the container (or a row in
  its subtree) raises that container's guide to `opacity: .85` via `guide-active`.
- Guides are structural, do not move with selection, and are not exposed to assistive technology.
- Guide colour is `--vscode-tree-indentGuidesStroke` with `--vscode-panel-border` fallback; the
  guide is never a second selection colour.

### 2.4 Details panel

- Selecting a node fills the panel: kind, primary label, full `DEFINITION-REF`, short name, variant
  and AUTOSAR type, value, decimal/hex/binary formats for integer parameters, target and context
  (references), conditions, annotations.
- For a parameter the **Value** row is an editable control. Integer/float/text use an input; Boolean
  uses a true/false `<select>`. The control is focused only by clicking the value, `F2` or `Enter`.
- Actions are **Jump to target** for a followable reference and **Reveal in source**. There is no
  Source block, Copy path, Copy value or Copy target.
- The panel starts hidden and is toggled by the toolbar's Details button.

### 2.5 Widths

- Details docked: `clamp(260px, 30%, 340px)`, border-left hairline.
- Narrow (<=720px): details becomes a bottom sheet with `max-height: 45vh`; the toolbar hides the
  count, notice and Details label; the document keeps its own horizontal scroll.

## 3. Typography and spacing

- Editor/monospace: `--vscode-editor-font-family`, `--ecuc-fs` (13px fallback), line height
  `1.55em`.
- UI font: toolbar, inspector keys/labels, count, notices.
- Document rows are one line high; comments (`/* ... */`) and conditions are inline metadata.
- `--fold-gutter`/`--content-pad`/`--doc-pad`/`--indent` are the horizontal geometry inputs. The old
  `--ln-w`, `--ln-digits`, `--gut` and `--ln-*` variables are removed.
- Selected row tint covers the full row; the focus rail is 2px at its left edge.

## 4. Colour and token system

All colours come from `--vscode-*` variables (with fallbacks). No hard-coded palette.

| Token | Source |
|---|---|
| keyword | `--vscode-debugTokenExpression-boolean` |
| string | `--vscode-debugTokenExpression-string` |
| number/hex | `--vscode-debugTokenExpression-number` |
| meta/variant/condition | `--vscode-debugTokenExpression-name` |
| comment/annotation | `--vscode-charts-green` (italic) |
| key accent (parameter labels) | `--vscode-symbolIcon-variableForeground` |
| container name (green) | `--container-accent` (fixed `#4EC9B0`; HC uses the editor foreground) |
| reference target (yellow italic) | `--vscode-symbolIcon-functionForeground` (fallback `#DCDCAA`) |
| punctuation | `--vscode-editor-foreground` mixed down |
| selection | `--vscode-list-inactiveSelectionBackground` / `activeSelectionBackground` |
| selected subtree | `--vscode-editor-selectionHighlightBackground` mixed down |
| selected container | same selection-highlight colour at a higher mix (`--sel-container-bg`) |
| focus rail | `--vscode-focusBorder` |
| bracket guide | `--vscode-tree-indentGuidesStroke` / `--vscode-panel-border` |

Container names are green like a C typedef/type; the dark pass uses a fixed `#4EC9B0` accent because
some themes map `symbolIcon.namespaceForeground` to the ordinary foreground. Reference targets are
yellow italic and plain text; the details Jump to target is the follow affordance. Other document
labels are neutral; module paths, context paths and `=`/braces/punctuation stay neutral/muted. No
per-kind glyph colours, no Tree chips, no line-number active colour.

### State colours

- Hover: `--vscode-list-hoverBackground`; the hovered container's bracket guide rises from 0.28 to 0.85.
- Selected parameter: active selection fill + 2px rail + 1px outline, so the row is unmistakable.
- Selected container/module: the visible neutral selection-highlight fill + the same rail + outline;
  visible descendants get the softer subtree tint.
- Dark is the supported theme. High contrast/forced colors use outlines, no fills.
- Flash after a successful edit: find-match highlight background fading out.
- Invalid details field: input validation error border and an error comment below.

## 5. Components and states

### Components

- **Toolbar**: filter, clear, count/status, labelled Collapse/Expand, Details.
- **Document row**: fixed fold gutter, label, optional `= value`, inline metadata.
- **Brace row**: `{` / `}` aligned with the owning row's text; no line number.
- **Value**: `=`, `.value-text`; parameters read-only, reference targets are plain text.
- **Details**: kind/label, AUTOSAR type, editable Value, integer formats, Jump/Reveal actions.
- **Empty state**: source comment `/* No entities match "...". */` + Clear filter.

### State matrix

| State | Document | Details |
|---|---|---|
| Idle | text, braces, metadata | hidden |
| Hover | row background, expanded chevron appears | n/a |
| Selected | tint + rail; selected subtree tint; bracket guides stay structural | filled from selected row |
| Focus | 2px rail | details button focus ring |
| Filtered | matches + ancestors, `<mark>` on rendered rows | selected row still shown |
| Editing | read-only value | focused value input |
| Refused | unchanged document | invalid input + reason |
| Collapsed | chevron + `{ ... }` stub | unchanged |

## 6. Interaction and accessibility

- Click a row: select; keep the document position.
- Click a parameter value text: select, open details, focus the value input.
- Click `=`/label: select only.
- Click a container's chevron: collapses or expands it; the selection does not move.
- Double-click / `Ctrl`/`Alt`+`Enter`: reveal in source.
- Reference target: details-only **Jump to target** when the target resolves in the same file;
  the Document value is not a link. An unresolved target has no jump action.
- `Enter` on a parameter: open details edit; on a container: toggle; otherwise reveal.
- Hovering a container (or a row in its subtree) makes its bracket guide clearer.
- `F2` on a parameter: open details edit.
- `Space`: select; arrows/Home/End/PageUp/PageDown/type-ahead traverse the visible rows.
- Details input: `Enter` commits, `Escape` restores the current value, `Tab`/`Shift`+`Tab` commits and
  moves to the adjacent parameter.
- The flat tree keeps `role="tree"`, `role="treeitem"`, `aria-level`, `aria-posinset`,
  `aria-setsize`, `aria-expanded`, `aria-selected` and roving tabindex.
- The accessibility tree exposes the rendered window; offscreen rows are reached by scrolling. This
  limitation is advertised, not hidden.
- The details input has an `aria-label`, `aria-invalid` on refusal, and a live error status.

## 7. Responsive and density

- <=720px: `--doc-pad: 2.5ch`, `--indent: 3ch`; the 26px fold gutter stays fixed; hide
  count/notice/Details label; details becomes a bottom sheet.
- Long labels/values scroll horizontally; no wrap.
- No line-number gutter to reserve space.
- Reduced motion: no twisty transition; flash steps.
- Forced colors/high contrast: outlines instead of fills.

## 8. Implementation mapping

### Markup changes

- Toolbar: no `#view-toggle`, no `.view-switch`; labelled Collapse/Expand and Details remain.
- `#tree` has no `data-ln-digits`; rows have no `data-line`; no `data-ln-*`.
- `#tree-measure` has one `.probe-doc` row (no Tree probes).
- Rows carry `data-subtree` when they are descendants of the selected container/module.
- Brace guides are absolute `.guide` spans with `data-level` and `data-container-id`; `guide-active`
  is toggled on hover.
- Details: parameter Value is an input built by `detailsValueInput`; no Source row or copy actions.
- The page state is `{ inspectorHidden }` only; an old `view` field is ignored and never written back.

### CSS mapping

- All page styles are scoped to the Document surface; `body[data-view="document"]` remains a static
  style hook.
- Removed: Tree grid/height/block, kind glyphs/classes (the twisty keeps its `.g-twisty` class),
  `.view-switch`, line-number variables and `::before`, repeating-gradient guides, inline value editor.
- Added: `--fold-gutter` (26px), `--content-pad`, `--doc-pad`, `--indent`, `.guide`/`guide-active`
  rules, a fixed 16px Codicon chevron, `data-subtree` tint, `.details-value`,
  `.details-value-error`, green container and yellow-italic reference accents.
- The toolbar's Collapse/Expand controls are labelled, >=28px wide and use 14px icons; labels hide
  only at narrow widths.

### Data/provider mapping

- `EcucRow` has no source-position fields; `RowDocument` has no `digits`.
- `ParameterNode.definitionDest` (from `DEFINITION-REF DEST`) feeds `EcucRow.definitionDest`,
  `parameterType` and the Decimal/Hexadecimal/Binary `formats`.
- `EcucRow.followable` is true only when the reference target resolves in this file; it drives the
  details **Jump to target** action, not a Document link.
- The webview `follow` message selects the same-file target node in the ECUC editor; `Reveal in
  source` remains a separate action.
- `RowPayload` is `{ rows, selectedId? }`.
- `renderHtml`/`buildRows` take no `lineIndex`.
- Re-scan message stays `{ type: 'model', rows, selectedId }`; the details editor clears on it.
- The provider has no copy branch; `clipboard.ts`/`copy.test.ts` are deleted.

### Does not change

- Ordering, the write path, manifest, dependencies, CSP and nonce model.
- The virtual window, filter/flatten engine, selection/focus/reveal/re-scan policy.
- `src/core/**` changes are limited to `DEFINITION-REF DEST` capture, type-aware validation, and
  removing the now-unused `hexValue` computation/field.

## 9. Performance and risks

- Payload is smaller without source/digits; the virtual window still renders viewport + overscan.
- The Document-only page removes the Tree measurement probes and glyph DOM. Bracket guide spans add
  only one node per open ancestor per rendered row.
- Risk: a guide leaking outside its container is guarded by `guidesFor` and its tests.
- Risk: details editing losing focus/refusal state is guarded by the details-editor tests and
  browser capture.
- Risk: brace/indent/guide misalignment is guarded by the `--doc-pad` + fold-column rules and
  deep/narrow captures.
- Risk: container/reference colours losing theme contrast is guarded by the `--vscode-*` fallbacks
  and dark/HC captures.

## 10. Decisions

1. Tree view removed; no hidden mode or setting.
2. Source line numbers removed; no display-index substitute.
3. Bracket-connected container guides always present, faded; clearer on hover. No selected-branch
   short segments.
4. Document read-only; editing in the details panel.
5. `F2` keyboard shortcut retained; F2 decoration removed.
6. Source block and copy actions removed; Reveal in source retained.
7. Details value input commits through the existing `{ type:'edit' }` write path.
8. Reference follow only for same-file targets; the action moves to **Jump to target** in details and
   the Document value is not a link.
9. Dark theme only for now; high contrast is the accessibility variant. No light-theme pass.
10. Container names green; reference targets yellow italic; parameter selection stronger.
11. Fixed 26px fold gutter with a 16px Codicon outline chevron; expanded chevrons are hover/focus
    only, collapsed chevrons always visible.
12. Reference tooltips show the target text without the document's `=` punctuation.
13. AUTOSAR parameter types come from `DEFINITION-REF DEST`; details shows Type plus integer
    Decimal/Hexadecimal/Binary formats, with no `(= 0x…)` in the Document.
14. Details editing is type-aware: integer/float literals, a Boolean selector and text otherwise.
15. An empty container ends in a muted `{ }` marker so it is distinct from a parameter.

## 11. Acceptance checklist

- [x] No Tree toggle, Tree CSS/glyphs/chips or view state.
- [x] No line numbers/gutter/data-line/digits.
- [x] Bracket guides run from opening to closing brace, faded at rest and clearer on hover.
- [x] Selected container tints its visible descendants; selected parameter has a strong outline.
- [x] Document values are read-only; `.value` is a direct `.row` child.
- [x] Value click/F2/Enter opens the details input; Enter/Escape/Tab/refusal work.
- [x] No F2 hint, Source block or copy actions.
- [x] Reference target is not a Document link; details Jump to target selects the same-file container.
- [x] AUTOSAR Type and integer Decimal/Hexadecimal/Binary formats show in details; the Document has no
      `(= 0x…)` meta.
- [x] Empty containers show a muted `{ }` marker at rest.
- [x] Integer/float/Boolean/text editing follows the parameter type; refusals keep the text.
- [x] Fixed 26px fold gutter, 16px Codicon chevron, hover-only expanded icons and always-visible
      collapsed icons.
- [x] Reference tooltips do not include the display `=`.
- [x] Dark/HC/narrow/deep/large/huge captures.
- [x] Full gates and mutation checks pass.
