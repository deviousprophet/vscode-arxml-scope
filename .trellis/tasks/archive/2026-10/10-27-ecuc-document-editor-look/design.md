# Design: ECUC document view editor-like visual pass

Read with `prd.md` and the prototype in `research/prototype-editor.css` / `prototype-dark.png`.
The structural/state/interaction contracts are the archived Document-view task
(`.trellis/tasks/archive/2026-10/10-27-ecuc-viewer-document-redesign/design.md`) and the parent
contracts (display rules, value widget, selection/collapse/a11y). This task changes presentation
only; it does not change the renderer, model or write path.

## 1. Diagnosis: why the current Document view feels like a web tree

The current document CSS is still a tree skin. It keeps:

- a full toolbar with a 560px-max filter and bordered buttons (`6px 10px` padding);
- the twisty/spacer in the flex flow (`1.2ch`), so every label is shifted one twisty track and
  nested lines are shifted again;
- per-kind label colours (module function, container namespace, parameter/reference variable), a
  purple variant/condition, and `textLink` + underline for targets;
- a bright list-selection background and focus background on the whole row;
- a dotted underline under every parameter value and a pencil glyph on hover;
- `margin-left` gaps on `.value`/`.row-meta` plus `margin-right` on every meta span, which makes a
  long module line wrap inside `.row-meta`.

The raw `.artext` feels calm because it has none of that: one foreground, a gutter, a single
baseline, values as plain text, and no per-line selection bar. The prototype removes the tree
signals and keeps only the semantic accents.

## 2. Presentation model

Still one DOM, one `data-view` attribute, CSS scoped under `body[data-view="document"]`. Tree view
rules are untouched. The document keeps the same rows, roles, ids, `matchRanges`, collapse/filter
state and `.value` direct child.

```
body[data-view="document"]
  .toolbar  (compact document bar)
  #content
    #main
      .meta (schema/package, gutter-aligned)
      #tree
        .node
          .row (position: relative)
            .twisty/.spacer (absolute, in the gutter)
            .label
            .value
            .row-meta
          .children (4ch; braces at the parent text start)
```

## 3. Editor surface

```css
body[data-view="document"] #tree {
  font-family: var(--vscode-editor-font-family, Consolas, "Courier New", monospace);
  font-size: var(--vscode-editor-font-size, 14px);
  line-height: 1.5;
  padding: 8px 0 24px 3.5ch;
}
body[data-view="document"] .meta {
  padding: 4px 0 2px 3.5ch;
  font-family: ...monospace;
  font-size: var(--vscode-editor-font-size, 14px);
  color: var(--vscode-editor-foreground);
}
body[data-view="document"] .row {
  position: relative;
  display: flex;
  flex-wrap: nowrap;
  gap: 1ch;
  align-items: baseline;
  padding: 0;
  border: 0;
  background: transparent;
}
body[data-view="document"] .node:hover > .row { background: transparent; }
body[data-view="document"] .label {
  flex: 0 0 auto;
  overflow: visible;
  text-overflow: clip;
  white-space: pre;
  font-weight: 400;
  color: var(--vscode-editor-foreground);
}
```

- `.meta` aligns with the first row (3.5ch) and uses the same 14px; the old 13px/grey header looked
  like disabled chrome.
- The row uses `gap: 1ch`, not margins, so the text spaces are exact and the last meta span leaves no
  trailing margin.
- `#main` stays the scroll container; long module lines overflow horizontally instead of wrapping.

## 4. Gutter and indentation

```css
body[data-view="document"] .twisty,
body[data-view="document"] .spacer {
  position: absolute;
  left: -2.2ch;
  top: 0.1em;
  width: 1.2ch;
  height: 1.2em;
  margin: 0;
  padding: 0;
  flex: none;
}
body[data-view="document"] .children {
  margin-left: 4ch;
  border-left: 0;
}
body[data-view="document"] .children::before,
body[data-view="document"] .children::after {
  display: block;
  margin-left: -4ch;
  color: var(--vscode-descriptionForeground);
  white-space: pre;
}
```

- The gutter is `3.5ch`; the twisty sits at `-2.2ch` (1.2ch wide) and does not shift the label.
- The first label starts at 3.5ch; each child at +4ch; the brace returns to the parent's text start
  with `-4ch`. This replaces the old `calc(-4ch + 1.2ch + 2px)`.
- No line numbers: braces are decorative pseudo-elements, so a real line-number column would
  require structural brace rows. The gutter is the twisty/fold gutter; a separate task can add real
  line numbers if wanted.
- The twisty remains keyboard-reachable (it is the same button) and becomes visible on row hover or
  focus; no text shifts.

## 5. Restrained palette

| Element | Selector | Colour |
|---|---|---|
| structural labels | `.label` | `--vscode-editor-foreground` |
| `schema`/`package` keywords | `.meta .keyword` | `--vscode-symbolIcon-keywordForeground` |
| module prefix | `.row.k-module .label::before` | keyword |
| short name / textual value | `.short`, `.value[data-value-kind="textual"]` | string |
| numeric / hex | `.value[data-value-kind="numeric"]`, `.hex` | number |
| boolean | `.value[data-value-kind="boolean"]` | boolean (keyword fallback) |
| variant | `.variant` | `--vscode-descriptionForeground` |
| condition | `.condition` | `--vscode-descriptionForeground` |
| context | `.context` | `--vscode-descriptionForeground` |
| annotation | `.annotation` | `--vscode-descriptionForeground`, italic |
| reference target | `.target` | `--vscode-editor-foreground`; **no underline**; hover: `textLink` + underline |

- Remove the per-kind label rules (`k-module` function, `k-container` namespace, `k-parameter` /
  `k-reference` variable). The module prefix and the line syntax already distinguish kinds; the
  raw file does not paint every label.
- The `schema`/`package` keywords need a document-specific `.meta .keyword` rule so the `.meta`
  foreground does not dominate the span.
- Reference targets are still clickable (`cursor: pointer`, `[data-follow]`), only the permanent
  underline/link colour goes away. Hover/focus restores the link affordance.

## 6. Selection and focus

The base list-selection rules stay for Tree view. Document view overrides them:

```css
body[data-view="document"] .node[data-selected="true"] > .row,
body[data-view="document"] .node:focus-visible > .row {
  --ecuc-selection-fg: var(--vscode-editor-foreground);
  background: var(--vscode-editor-lineHighlightBackground, var(--vscode-list-inactiveSelectionBackground));
  outline: none;
}
body[data-view="document"] .node:focus-visible > .row {
  box-shadow: inset 2px 0 0 var(--vscode-focusBorder);
}
body[data-view="document"] .node[data-selected="true"] > .row > .value,
... token/selection children ... {
  color: var(--ecuc-selection-fg);
}
```

- The line highlight is subtle; the semantic colours switch to the editor foreground on the
  selected/focused line for contrast (the existing `--ecuc-selection-fg` mechanism).
- The focus edge is a 2px inset left border, not a full outline box. It stays visible in HC.
- Hover has no full-row background; the twisty still appears.

## 7. Value affordance

In Document view:

```css
body[data-view="document"] .row.k-parameter > .value {
  border-bottom: 0;
  cursor: text;
}
body[data-view="document"] .row.k-parameter:hover > .value::after {
  content: none;
}
body[data-view="document"] .value-edit {
  padding: 0 2px;
  font-size: inherit;
  line-height: inherit;
  vertical-align: baseline;
}
```

- The dotted underline and pencil are Tree-view affordances; in a document they read as form
  controls. The tooltip (`Click to edit, or press F2`) and the text cursor remain.
- `.value` stays a direct child; the widget's first-listener/`stopImmediatePropagation` contract is
  untouched. The inline input is still a flex child in the value's place.

## 8. Slim document bar

```css
body[data-view="document"] .toolbar {
  min-height: 0;
  padding: 3px 8px;
  gap: 3px 4px;
  border-bottom: 1px solid var(--vscode-editorGroup-border, var(--vscode-panel-border));
}
body[data-view="document"] .toolbar .filter {
  max-width: 240px;
  height: 22px;
  font-size: 12px;
  border-color: transparent;
  background: var(--vscode-input-background);
  border-radius: 2px;
}
body[data-view="document"] .toolbar .tool {
  padding: 2px 6px;
  border: 0;
  background: transparent;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}
body[data-view="document"] .toolbar .tool:hover {
  color: var(--vscode-foreground);
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}
body[data-view="document"] .toolbar .count { font-size: 11px; }
```

- The toolbar remains the same DOM/actions; only its weight changes. The filter remains visible and
  focusable. Tree view keeps the current bar.
- The `.filter-wrap` is `flex: 1 1 280px; max-width: 560px`; cap the document filter with
  `max-width: 240px` on the input or the wrap. Use the input cap to avoid changing the wrap.

## 9. Contracts that must not move

- `.value` direct child; widget selectors; first-listener order and `stopImmediatePropagation`.
- `.row-meta` remains the single rendered source for the inspector; it must stay visible (inline
  flex, not hidden).
- `.meta` stays schema/package; `.row-meta` stays secondary fields.
- `reRenderTree` order, `#main` scroll, filter/collapse/selection state, node ids, `matchRanges`,
  aria roles/levels/positions, value editing, reveal/follow/copy.
- Tree view's CSS and DOM are unchanged.

## 10. Verification

| Layer | Evidence |
|---|---|
| Prototype | `research/prototype-dark.png` over the production page with a nonce-bearing style |
| Markup/CSS | tests for neutral labels, no target underline, gutter/absolute twisty, slim bar, subtle selection, no dotted value |
| Behaviour | existing editing/interaction/filter/reveal/reference suites; browser click/filter/edit pass |
| Visual | Document and Tree in light/dark/HC; selected/focused row |
| Mutations | restore per-kind label colours, target underline, dotted value, flow twisty, active-selection bar, 6px toolbar → a test fails |
| Limits | harness is not a VS Code webview; real theme/font/focus remains a host check |

## 11. Rollback

Remove the document overrides or set `data-view="tree"` as the default; the Tree view, model, write
path and core are untouched. No setting, migration or new dependency is involved.

## 12. Wrong vs correct

**Wrong — paint every kind to prove it is a tree.**

```css
body[data-view="document"] .row.k-module .label { color: function; }
body[data-view="document"] .row.k-container .label { color: namespace; }
```

**Correct — neutral labels, semantic values.**

```css
body[data-view="document"] .label { color: var(--vscode-editor-foreground); }
body[data-view="document"] .short { color: var(--vscode-symbolIcon-stringForeground); }
```

**Wrong — keep the web affordances.**

```css
.target { color: var(--vscode-textLink-foreground); text-decoration: underline; }
.row.k-parameter > .value { border-bottom: 1px dotted; }
```

**Correct — text first; affordance on hover.**

```css
body[data-view="document"] .target { color: var(--vscode-editor-foreground); text-decoration: none; }
body[data-view="document"] .target:hover { color: var(--vscode-textLink-foreground); text-decoration: underline; }
body[data-view="document"] .row.k-parameter > .value { border-bottom: 0; }
```

**Wrong — leave the twisty in the flow.**

```css
.twisty, .spacer { flex: 0 0 1.2ch; }
```

**Correct — put it in the gutter.**

```css
.twisty, .spacer { position: absolute; left: -2.2ch; width: 1.2ch; }
```
