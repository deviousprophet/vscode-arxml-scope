# Design: ECUC viewer document-style redesign

Read with `prd.md` and the reference capture in `research/reference-artext/`. The contracts this must
not break are in `../10-14-artext-custom-editor/design.md` (parent §6 display rules, provider, reveal),
`../10-14-ecuc-editor-ux/design.md` (selection/collapse/state/accessibility) and
`../10-14-ecuc-value-editing/design.md` (the widget's click/key ownership and `.value` direct child).

## 1. The reference, honestly

The reference branch's tool is `mmx` + `Arxml2Artext.mm`. It produces a text document; the extension
then applies `postProcessArtextGen`:

```ts
content = content.replace(/\[([\s\S]*?)\]/g, (_, i) => `[${i.replace(/\s+/g, '')}]`);
```

`research/reference-artext/display-rules.artext` is that post-processed output. It is a **look**
reference, not a format to reintroduce:

```text
schema 00048
package PkgA.PkgB

module PkgA.PkgB.ModDefs.ModX "ModX" (VariantPreCompile) [(A==B)] <Crit1 == 1 && Crit2 == 2> /* [Note] module note */
{
    ContA "ContA" /*container note */
    {
        Flag = true
        IniValue = 63 (= 0x3F)
        ...
    }
}
```

The reference grammar scopes are mapped in §4. The highlighted HTML in `research/reference-artext/`
is a research mock using VS Code Dark+ token colours; the product must use `--vscode-*` variables.

## 2. Presentation model: one DOM, two views

The viewer already has a tree DOM with the needed semantics: `role="tree"`, `treeitem`/`group`,
`aria-level`, `aria-expanded`, `tabindex`, data attributes, `.row`, `.label`, `.value`, `.row-meta`.
The redesign does **not** create a second renderer or a new model.

```
body[data-view="document"|"tree"]
  .toolbar: filter, count, notice, expand/collapse, View toggle, Details toggle
  #content
    #main (scroll)
      #tree (same tree; document CSS overrides)
    #inspector (hidden by default)
```

- `renderHtml` writes `data-view="document"` on `<body>`; the page script reads the saved view and may
  switch it to `tree`.
- Tree view keeps the current CSS untouched. Document selectors are scoped under
  `body[data-view="document"]`, so reverting is a class change, not a renderer change.
- `#main` remains the scroll container; document lines may be wider than the pane, so `#main` keeps
  `overflow: auto` and the document allows horizontal scrolling (like the reference text editor).

## 3. Document layout

The same row markup is styled as a document line:

| Current tree | Document |
|---|---|
| `.row` grid with 26ch label / value / second metadata line | `.row` inline flex, one line; label, value, metadata in text order |
| `.label` fixed 26ch, bold | `.label` content width, normal weight, token colour by kind |
| `.value` separate column, ellipsis | inline after the label, no ellipsis; the pane scrolls horizontally |
| `.row-meta` second flex line | inline after the value with 1ch gaps |
| `.condition` / `.annotation` chips | inline text; annotation wrapped in `/* … */`, no borders/padding |
| kind glyph + 2px row border | no glyph/border; the label colour and module prefix carry the kind |
| `.children { margin-left:14px; border-left }` | `.children { margin-left:4ch; border-left:0 }` with `{`/`}` pseudo-elements |
| details inspector open by default | hidden by default; toolbar toggle |

Document CSS sketch:

```css
body[data-view="document"] #tree {
  font-family: var(--vscode-editor-font-family, Consolas, monospace);
  font-size: var(--vscode-editor-font-size, var(--vscode-font-size, 13px));
  line-height: 1.5;
}
body[data-view="document"] .row {
  display: flex; flex-wrap: nowrap; gap: 0; align-items: baseline;
  padding: 0 8px 0 2px;
}
body[data-view="document"] .glyph { display: none; }
body[data-view="document"] .twisty,
body[data-view="document"] .spacer { flex: 0 0 1.2ch; width: 1.2ch; }
body[data-view="document"] .label { flex: 0 0 auto; font-weight: 400; overflow: visible; }
body[data-view="document"] .value { margin-left: 1ch; max-width: none; overflow: visible; }
body[data-view="document"] .row-meta {
  display: inline; margin-left: 1ch; font-size: inherit; color: var(--vscode-descriptionForeground);
}
body[data-view="document"] .row-meta > span {
  max-width: none; overflow: visible; white-space: nowrap; margin-right: 1ch;
}
body[data-view="document"] .condition,
body[data-view="document"] .annotation { padding: 0; border: 0; border-radius: 0; }
body[data-view="document"] .children { margin-left: 4ch; border-left: 0; }
body[data-view="document"] .children::before,
body[data-view="document"] .children::after {
  display: block; margin-left: -4ch; color: var(--vscode-descriptionForeground);
}
body[data-view="document"] .children::before { content: "{"; }
body[data-view="document"] .children::after { content: "}"; }
```

- **Module prefix.** `body[data-view="document"] .row.k-module .label::before { content: "module "; color: var(--vscode-symbolIcon-keywordForeground, ...); }` mirrors the reference's `module` keyword. It is presentation only; the aria label/content is unchanged.
- **Braces.** The pseudo-elements are decorative and not announced; the group/level semantics remain
  the tree's.
- **Meta wrapping.** A very long line scrolls in `#main` rather than wrapping; this matches the
  reference and keeps one entity per line. The inspector and filter still work.
- **Value editing.** The inline input remains a direct flex child where the value span was; the tree
  grid rules do not apply in document mode. The widget's `.value` selector is unchanged.
- **Selection/focus.** Document labels use kind colours; the existing selection/focus emphasis
  (`--ecuc-selection-fg`) must also cover the label and the module prefix, so a selected/focused line
  does not keep a low-contrast token colour. This is a required addition, not a nice-to-have.

## 4. Token scopes and colours

The reference grammar's scopes are the semantic model; the product maps them to theme variables. It
does not consume the `.artext` file.

| Element | Reference scope | CSS class / selector | Theme variable(s) |
|---|---|---|---|
| `schema` / `package` | `keyword.control.artext` | `.meta` text | `--vscode-symbolIcon-keywordForeground` fallback foreground |
| `module` prefix | `keyword.control.artext` | `.row.k-module .label::before` | keyword |
| module path | `entity.name.function` | `.row.k-module .label` | `--vscode-symbolIcon-functionForeground` → module → class |
| container label | `entity.name.type` | `.row.k-container .label` | `--vscode-symbolIcon-namespaceForeground` |
| parameter/reference name | `variable.other` | `.row.k-parameter .label`, `.row.k-reference .label` | `--vscode-symbolIcon-variableForeground` |
| string / short name | `string.quoted.double` | `.short` (and textual value) | `--vscode-symbolIcon-stringForeground` |
| number / hex | `constant.numeric` / `.hex` | `.value[data-value-kind="numeric"]`, `.hex` | `--vscode-symbolIcon-numberForeground` |
| boolean | `constant.language.boolean` | `.value[data-value-kind="boolean"]` | `--vscode-symbolIcon-booleanForeground` → keyword |
| variant | `meta.annotation.variant.artext` | `.variant` | `--vscode-symbolIcon-enumeratorForeground` |
| reference target | `entity.name.function` | `.value.target` | `--vscode-textLink-foreground` |
| condition | keyword/operator | `.condition` | `--vscode-symbolIcon-keywordForeground` |
| annotation | comment | `.annotation` | `--vscode-descriptionForeground`, italic, `/* … */` |
| context | comment/secondary | `.context` | `--vscode-descriptionForeground` |

- The Dark+ HTML mock in research uses the standard token colours; the product keeps theme variables
  and fallbacks, not those literals.
- Selected/focused lines use the selection foreground; the document label and pseudo-prefix are
  included in the emphasis rule.
- No colour literal outside a `var(...)` fallback; the only existing literal remains `#80808040`.

## 5. State: view, details and persistence

Add to the existing webview state object (the same one that already stores `inspectorHidden`):

```ts
{ view: 'document' | 'tree', inspectorHidden: boolean }
```

- Defaults when the saved state is missing or invalid: `view = 'document'`, `inspectorHidden = true`.
- `renderHtml` writes `data-view="document"` on `<body>` and renders the inspector `hidden` with the
  details toggle `aria-pressed="false"` as the first-paint defaults. The script applies a saved `tree`
  or a saved shown inspector immediately on load.
- `#view-toggle` is a single button: it shows the action/next state with a title (e.g. "Switch to tree
  view") and sets `aria-pressed` to `view === 'document'`. The tree view is the existing presentation.
- `#details-toggle` keeps `aria-pressed` equal to "panel visible". The panel is outside `#main`, so a
  re-scan does not destroy it.
- Both preferences go through `getState()/setState()`; the harness stub persists them in
  `localStorage`, as before. Invalid saved values fall back to the defaults.

## 6. Interactions and contracts that must not move

The document view is a CSS mode over the tree DOM, so these stay exactly as they are:

- `.value` is a direct child of `.row`; the widget (`:scope > .row > .value`), `highlightableSpans` and
  the editing tests depend on it.
- The value widget's document `click`/`keydown` listeners are registered first and claim their events
  with `stopImmediatePropagation`.
- The tree's click model: a click selects; the twisty toggles; a reference target follows; a double
  click or Ctrl/Alt+Enter reveals; Space selects; Enter toggles/reveals.
- `reRenderTree`'s seven-step order and `#main` scroll container.
- Filter/collapse state restoration, node ids, `matchRanges`, aria roles/levels/positions, and the
  no-takeover manifest priority.
- The document mode must not hide entity fields; it moves the secondary fields inline. All parent §6
  fields remain in the markup (tests compare document/tree content).

## 7. Accessibility and contrast

- The document styling changes visuals only; the DOM remains a real tree with the same roles and
  keyboard map. Pseudo-braces are decorative; they are not announced and do not replace groups.
- The document label colours are semantic; selected/focused rows use the emphasis foreground for
  labels, prefixes, values and metadata. Contrast is measured in the harness in light/dark/HC.
- The document uses the editor font with a system monospace fallback; font size uses
  `--vscode-editor-font-size` with a 13px fallback. No font file is added.
- The details panel is hidden by default but its content is unchanged; opening it is a toolbar action,
  not a hover-only affordance.

## 8. Performance

The document view adds no DOM nodes (except the toolbar toggle and CSS pseudo-elements) and no second
render pass. The same `renderTree` string and the same `#main` scroll are used. The 4,001/12,001-node
samples are observed in Document view; if the document line rendering is slower than the tree, record
it. No virtualisation is added in this task.

## 9. Verification

| Layer | Evidence |
|---|---|
| Reference | post-processed `.artext`, highlighted HTML mock, README with command/postprocess |
| Markup | document `data-view`, view toggle, default-hidden inspector, all fields still present |
| CSS | document overrides (monospace, one line, 4ch indent, braces, no chips/grid/borders), token selectors, fallbacks |
| Script | view/details defaults, toggle state saving, `getState` validation |
| Interactions | existing tests plus browser pass: select/collapse/reveal/follow/filter/edit/copy/keyboard |
| Visual | document vs tree in light/dark/HC; large/huge page loads |
| Mutations | remove document default/CSS/view toggle/hidden details → a test fails |
| Limits | browser harness is not a VS Code webview; real theme/font/performance/focus remains a host check |

## 10. Rollback

Set `data-view="tree"`/render tree by default, or remove the document CSS/selectors, to return to the
current viewer. The view toggle and default-hidden inspector are additive. No core, write-path or
manifest change is involved; no setting/migration is introduced.

## 11. Wrong vs correct

**Wrong — a second renderer that parses `.artext`.**

```ts
const artText = runLegacyMmx(arxml); // product must not depend on the legacy binary
```

**Correct — present the existing model as a document.**

```ts
renderHtml(model, { view: 'document', lineIndex, ... });
// the same tree DOM; document CSS + toggles
```

**Wrong — hide the metadata to make the document look clean.**

```css
.row-meta { display: none; }
```

**Correct — inline it in the document line.**

```css
body[data-view="document"] .row-meta { display: inline; margin-left: 1ch; }
```

**Wrong — hard-code the Dark+ token hex values.**

```css
.label { color: #dcdcaa; }
```

**Correct — map the scope to a theme variable with a fallback.**

```css
body[data-view="document"] .row.k-module .label {
  color: var(--vscode-symbolIcon-moduleForeground, var(--vscode-foreground));
}
```
