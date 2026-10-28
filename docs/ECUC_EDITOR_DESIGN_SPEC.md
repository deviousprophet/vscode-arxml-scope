# ECUC Editor Design Spec

**Status:** current for the Document-only UI (2026-10-28). Supersedes the earlier Document/Tree,
source-line gutter, inline-edit, F2-hint, Source-block and copy-action design.

**Scope:** presentation only. The information model, interactions, DOM contracts, `src/core/**`, the
write path and the manifest do not change.

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
- Geometry: `--doc-pad: 3ch` (`2.5ch` narrow), `--indent: 4ch` (`3ch` narrow). A level-3 row uses
  `padding-left: calc(var(--doc-pad) + var(--indent) * 2)` (`level - 1`); braces add the 3ch fold
  column so they align with the row text.
- The fold column is an inline 2ch twisty/spacer before the label; leaves keep the spacer.
- A container with children has a 12px twisty at 0.7 opacity at rest; the span covers the full row
  height so the whole line toggles, and hover/focus raises it to 1.
  A collapsed container always shows its chevron and a `{ ... }` stub.
- One blank line between modules; braces on their own lines.
- No list bullets, per-row borders, chips, fixed label columns or vertical rules across the whole
  surface.

### 2.3 Bracket guides

- Each container draws one 1px vertical guide per nesting level, from its opening brace to its
  closing brace. The guide sits at the brace column (`--doc-pad + --indent * (level - 1) + 3.5ch`).
- Nested containers add their own guide: a row inside two containers carries both segments.
- Guides are always present but faded (`opacity: .28`) at rest; hovering the container (or a row in
  its subtree) raises that container's guide to `opacity: .85` via `guide-active`.
- Guides are structural, do not move with selection, and are not exposed to assistive technology.
- Guide colour is `--vscode-tree-indentGuidesStroke` with `--vscode-panel-border` fallback; the
  guide is never a second selection colour.

### 2.4 Details panel

- Selecting a node fills the panel: kind, primary label, full `DEFINITION-REF`, short name and
  variant, value, hexadecimal form (parameters), target and context (references), conditions,
  annotations.
- For a parameter the **Value** row is an editable `<input class="details-value">`. The input is
  visible whenever a parameter is selected, but is focused only by clicking the value, `F2` or
  `Enter`.
- The only action is **Reveal in source**. There is no Source block, Copy path, Copy value or Copy
  target.
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
- `--doc-pad`/`--indent` are the only horizontal geometry inputs. The old `--ln-w`, `--ln-digits`,
  `--gut` and `--ln-*` variables are removed.
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
| container name (green) | `--vscode-symbolIcon-namespaceForeground` (fallback `#4EC9B0`) |
| reference target (yellow italic) | `--vscode-symbolIcon-functionForeground` (fallback `#DCDCAA`) |
| punctuation | `--vscode-editor-foreground` mixed down |
| selection | `--vscode-list-inactiveSelectionBackground` / `activeSelectionBackground` |
| selected subtree | `--vscode-editor-selectionHighlightBackground` mixed down |
| focus rail | `--vscode-focusBorder` |
| bracket guide | `--vscode-tree-indentGuidesStroke` / `--vscode-panel-border` |

Container names are green like a C typedef/type; reference targets are yellow italic. Other document
labels are neutral; module paths, context paths and `=`/braces/punctuation stay neutral/muted.
Reference targets underline on hover only. No per-kind glyph colours, no Tree chips, no line-number
active colour.

### State colours

- Hover: `--vscode-list-hoverBackground`; the hovered container's bracket guide rises from 0.28 to 0.85.
- Selected parameter: active selection fill + 2px rail + 1px outline, so the row is unmistakable.
- Selected container/module: selected row tint + rail; visible descendants get the subtree tint.
- Dark is the supported theme. High contrast/forced colors use outlines, no fills.
- Flash after a successful edit: find-match highlight background fading out.
- Invalid details field: input validation error border and an error comment below.

## 5. Components and states

### Components

- **Toolbar**: filter, clear, count/status, labelled Collapse/Expand, Details.
- **Document row**: twisty/spacer, label, optional `= value`, inline metadata.
- **Brace row**: `{` / `}` aligned with the owning row's text; no line number.
- **Value**: `=`, `.value-text`; parameters read-only, references follow targets.
- **Details**: kind/label, field rows, editable Value for parameters, Reveal action.
- **Empty state**: source comment `/* No entities match "...". */` + Clear filter.

### State matrix

| State | Document | Details |
|---|---|---|
| Idle | text, braces, metadata | hidden |
| Hover | row background, twisty visible | n/a |
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
- Twisty: toggle collapse without moving selection.
- Double-click / `Ctrl`/`Alt`+`Enter`: reveal in source.
- Reference target: follows only when the target resolves in the same file; the target container is
  selected in the ECUC editor. An unresolved target is not a link.
- `Enter` on a parameter: open details edit; on a container: toggle; on a followable reference:
  select its same-file target; otherwise reveal the reference.
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

- <=720px: `--doc-pad: 2.5ch`, `--indent: 3ch`; hide count/notice/Details label; details becomes a
  bottom sheet.
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
- Added: `--doc-pad`, `--indent`, `.guide`/`guide-active` rules, `data-subtree` tint,
  `.details-value`, `.details-value-error`, green container and yellow-italic reference accents.
- The toolbar's Collapse/Expand controls are labelled, >=28px wide and use 14px icons; labels hide
  only at narrow widths.

### Data/provider mapping

- `EcucRow` has no source-position fields; `RowDocument` has no `digits`.
- `EcucRow.followable` is true only when the reference target resolves in this file; unresolved
  targets get no target class, no `data-follow` and no hover link.
- The webview `follow` message selects the same-file target node in the ECUC editor; `Reveal in
  source` remains a separate action.
- `RowPayload` is `{ rows, selectedId? }`.
- `renderHtml`/`buildRows` take no `lineIndex`.
- Re-scan message stays `{ type: 'model', rows, selectedId }`; the details editor clears on it.
- The provider has no copy branch; `clipboard.ts`/`copy.test.ts` are deleted.

### Does not change

- `src/core/**`, ordering, validation, the write path, manifest, dependencies, CSP and nonce model.
- The virtual window, filter/flatten engine, selection/focus/reveal/re-scan policy.

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
8. Reference follow only for same-file targets; it selects the target container in the editor.
9. Dark theme only for now; high contrast is the accessibility variant. No light-theme pass.
10. Container names green; reference targets yellow italic; parameter selection stronger.

## 11. Acceptance checklist

- [x] No Tree toggle, Tree CSS/glyphs/chips or view state.
- [x] No line numbers/gutter/data-line/digits.
- [x] Bracket guides run from opening to closing brace, faded at rest and clearer on hover.
- [x] Selected container tints its visible descendants; selected parameter has a strong outline.
- [x] Document values are read-only; `.value` is a direct `.row` child.
- [x] Value click/F2/Enter opens the details input; Enter/Escape/Tab/refusal work.
- [x] No F2 hint, Source block or copy actions.
- [x] Reference target is a link only when same-file, and follows to the target container.
- [x] Dark/HC/narrow/deep/large/huge captures.
- [x] Full gates and mutation checks pass.
