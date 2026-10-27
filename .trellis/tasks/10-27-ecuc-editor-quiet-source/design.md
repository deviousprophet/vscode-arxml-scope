# Design: ECUC editor quiet-source implementation

Read with `docs/ECUC_EDITOR_DESIGN_SPEC.md` (the review baseline), the prototype
`docs/ecuc-editor-prototype.html`, and `research/prototype-spec.png`. This design maps that spec onto
the existing renderer/provider without changing the model, interactions, write path or manifest.

## 1. Adopted decisions

The spec flags five decisions. The implementation adopts the recommended defaults:

- **D1:** keep the single optional key accent on parameter/reference labels
  (`--tok-key` = `symbolIcon-variableForeground`); one variable reverts to fully neutral.
- **D2:** show real source line numbers via `data-line`; header and braces are unnumbered.
- **D3:** show the muted `F2` hint on the selected parameter line (generated content, `aria-hidden`
  by construction).
- **D4:** align the Tree view surface (strip, typography, tokens, states, target hover) but keep its
  two-line grid, 26ch label column, chips, glyphs, per-kind accents and dotted values.
- **D5:** defer the optional `/` and `Ctrl+F` filter shortcut. No new keybinding/listener in this
  task.

## 2. Boundaries

**Changed**

- `src/editor/renderHtml.ts` — the shell, `renderTree`, `STYLE`, `TREE_SCRIPT`.
- `src/editor/ecucValueEditor.ts` — only the invalid-reason presentation in the existing message
  branch (no new listeners/state).
- `src/editor/filter.ts` — the empty-state text (source-comment form), no filter logic change.
- `src/test/editor/*` — document/color/polish expectations and new quiet-source tests.
- `docs/ECUC_EDITOR.md`, `.trellis/spec/frontend/{component-guidelines,quality-guidelines,testing}.md`.
- Task captures/research only.

**Unchanged**

- `src/core/**`, `ecucEditorProvider.ts` host behavior, `ecucEdit.ts`, `navigation.ts`, `nodeId.ts`,
  `clipboard.ts`, the manifest and its `priority`.
- State keys `{ view, inspectorHidden }`, DOM contracts (`.value` direct child, value-widget
  first-listener/`stopImmediatePropagation`, `.row-meta` inspector source, node ids/`matchRanges`),
  roles/aria, interactions and the one-DOM/two-view model.

## 3. Renderer and gutter data

`renderTree` currently returns `.meta` + `#tree` + `#empty` as siblings. Wrap them in
`<div class="document" style="--ln-digits:N">` so the header, tree and empty line inherit the same
gutter variables. This is the only wrapper change; the region is still swapped whole on a re-scan.

- `Ctx` gains `maxLine`, updated in `item()` from `ctx.lineIndex?.positionAt(spec.range.start)`.
  `--ln-digits` is `String(ctx.maxLine || 1).length`.
- The row gets `data-line="<start.line + 1>"` (1-based; the inspector's existing `.node` `data-line`
  stays 0-based). Header/braces get no `data-line`.
- `.document` defines `--ln-w = calc(var(--ln-digits, 4) * 1ch + 1ch)` and
  `--gut = calc(var(--ln-w) + 4ch)`.
- `#tree` is `position: relative`; rows stay unpositioned, so `.row::before` (the line number) anchors
  to `#tree` at `left: 0; width: var(--ln-w); text-align: right`.
- `#tree` has `padding-left: var(--gut)`, top `0.5 × --ecuc-lh`, right `2ch`, bottom `3 × --ecuc-lh`;
  `.children` keeps its `4ch` margin; braces use `-4ch`.
- `.meta` and `#empty` use `padding-left: var(--gut)` so header/empty text starts at the document
  text column without a number.
- A blank row height separates the header from the first module and sibling modules:
  `.meta { margin-bottom: var(--ecuc-lh) }` and `#tree > .node + .node { margin-top: var(--ecuc-lh) }`.
  No blank rows between containers.
- The line-number pseudo-element is Document-only. Tree view keeps its grid.

## 4. CSS token system

Define the spec's token block on `body[data-view]`:

```css
--ecuc-fs: var(--vscode-editor-font-size, 13px);
--ecuc-lh: calc(var(--ecuc-fs) * 1.55);
--tok-keyword: var(--vscode-debugTokenExpression-boolean, var(--vscode-editor-foreground));
--tok-string: var(--vscode-debugTokenExpression-string, var(--vscode-editor-foreground));
--tok-number: var(--vscode-debugTokenExpression-number, var(--vscode-editor-foreground));
--tok-meta: var(--vscode-debugTokenExpression-name, var(--vscode-editor-foreground));
--tok-comment: var(--vscode-charts-green, var(--vscode-editor-foreground));
--tok-comment: color-mix(in srgb, var(--vscode-charts-green, var(--vscode-editor-foreground)) 85%, var(--vscode-editor-background));
--tok-key: var(--vscode-symbolIcon-variableForeground, var(--vscode-editor-foreground));
--tok-punct: var(--vscode-editor-foreground);
--tok-punct: color-mix(in srgb, var(--vscode-editor-foreground) 70%, var(--vscode-editor-background));
--tok-dim: var(--vscode-editor-foreground);
--tok-dim: color-mix(in srgb, var(--vscode-editor-foreground) 55%, var(--vscode-editor-background));
--hover-bg: var(--vscode-list-hoverBackground, transparent);
--sel-bg: var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-lineHighlightBackground, transparent));
--sel-bg-focus: var(--vscode-list-activeSelectionBackground, var(--vscode-list-inactiveSelectionBackground, transparent));
--sel-bg-focus: color-mix(in srgb, var(--sel-bg-focus) 45%, transparent);
--rail: var(--vscode-focusBorder, var(--vscode-editorCursor-foreground, var(--vscode-editor-foreground)));
```

The duplicate plain declarations are the older-host fallback before `color-mix`; VS Code 1.143 (the
test host) supports `color-mix`. No new literal colour; the only literal stays `#80808040`.

Mapping (both views unless noted): `.keyword`/boolean values → `--tok-keyword`; `.short`/textual
values → `--tok-string`; numeric/hex/schema release → `--tok-number`; `.variant`/`.condition` →
`--tok-meta`; `.annotation` → `--tok-comment` + italic; `.context` → keyword `context` + neutral path;
parameter/reference labels → `--tok-key` (D1); module/container labels, targets, context paths →
`--vscode-editor-foreground`; punctuation (`=`, braces, stub) → `--tok-punct`; strip/keys/hints →
`--tok-dim`.

`.target` is neutral with no underline at rest in **both** views; hover gives
`--vscode-textLink-foreground` + underline + pointer. Tree's dotted `.value` underline, chips, glyphs
and per-kind accents stay.

## 5. Document layout and states

- `#tree`/Document: editor font, `--ecuc-fs`/`--ecuc-lh`, `font-variant-ligatures: none`, `tab-size: 4`,
  `white-space: pre`, horizontal scroll via `#main`.
- `.row`: flex, `gap: 1ch`, no padding/border/background at rest; **not positioned**.
- `.row::before` line number: `content: attr(data-line)`, absolute to `#tree`, active colour on
  `.node[data-selected="true"]`, focus colour where applicable.
- `.twisty`/`.spacer`: absolute in the fold column (`left: calc(var(--ln-w) + 1ch); width: 2ch`);
  expanded chevrons hidden unless `#tree:hover`/`:focus-within` (Document only); collapsed chevrons
  always visible.
- `.node[aria-expanded="false"] > .row::after { content: " { … }"; color: var(--tok-punct) }`.
- `.node[data-kind="parameter"][data-selected="true"] > .row::after { content: "  F2"; color: var(--tok-dim) }`.
  Generated content, no accessible text.
- Selection: `.node[data-selected] > .row { background: var(--sel-bg) }`;
  `#tree:focus-within .node[data-selected] > .row { background: var(--sel-bg-focus) }`; a 2px
  `inset` rail on focus. **Do not recolour tokens** on selection. Remove the old
  `--ecuc-selection-fg`/monochrome rules.
- Hover: `--hover-bg` on the row; value hover gets cursor text + a faint value background; target hover
  underline.
- Editing/invalid: input background/focus outline; invalid keeps text and adds an error-coloured
  trailing comment-style reason from the existing `notice` message. Add the reason element in the
  value-editor's existing `notice` branch; remove it on close/commit.
- High contrast: `@media (forced-colors: active), body.vscode-high-contrast` uses outlines, no fills;
  no colour-only cues.
- Reduced motion: stepped flash (existing `.node.flash` animation).

## 6. Strip and shell

Current toolbar markup is regrouped, no new ids/listeners:

- Filter placeholder `Filter`; transparent at rest, input background via `:not(:placeholder-shown)`,
  focus outline; count muted and only active while filtering.
- Collapse-all then expand-all as icon buttons with inline SVG, `aria-label`/`title`; keep ids.
- `#view-toggle` becomes one button containing `Document | Tree` spans; the existing click handler
  still toggles. `aria-pressed="true"` means Document; CSS highlights the active span; `applyView`
  sets only `aria-pressed`/`title` (no longer `textContent`).
- Details toggle: inline icon + `Details` label; at narrow the label hides but `aria-label` stays.
- Strip: 26px, UI font 12px, editor background, 1px `editorGroup-border` bottom hairline, no wrap at
  wide widths; flat transparent buttons with `toolbar-hoverBackground`; no filled badges.
- Filter clear becomes an inline-SVG × inside the existing button.
- Notice remains the existing role/status line; muted.
- Details panel width `clamp(260px, 30%, 340px)`, editor background, 1px hairline, stacked keys
  (11px UI, muted) over values (editor font), flat actions, spec empty copy; ≤720px bottom sheet
  `max-height: 45vh`.

## 7. Tree view alignment

Shared: strip, editor font family/size for the tree, `--tok-*` values, selection tint/rail, hover,
target hover-only underline, details and empty state. Kept: base two-line grid, 26ch label column,
chips, glyphs, per-kind border accents and dotted `.value` underline. The Document-only hide-glyph,
flex row, gutter, line numbers, braces and empty-gutter rules must not leak into Tree.

## 8. Responsive

`@media (max-width: 720px)`: Document line numbers hidden, fold column kept, `--gut: 3ch`, indent
`3ch`, `#tree` padding adjusted; strip count/labels hidden, icons keep `aria-label`; filter takes the
remaining width; details becomes a bottom sheet. Tree view keeps its structure; its strip also
compacts. No soft wrap.

## 9. Compatibility and risks

- `color-mix` requires a modern Chromium; VS Code 1.143 test host supports it. The plain fallback
  declarations keep older hosts monochrome rather than broken.
- The absolute line numbers assume `.row` and ancestors up to `#tree` are unpositioned. The current
  `.row` must lose `position: relative` from the previous document pass; if a later change positions
  it, anchor the number differently (spec risk table).
- The gutter numbers scroll with the content horizontally; accepted for v1.
- Selection tints over tokens must keep ≥4.5:1 in dark/light; if a theme fails, reduce the tint for
  that state rather than recolouring tokens.
- `data-line` on the row and `.node` `data-line` are different bases (1-based vs 0-based). Do not
  "fix" the inspector to 1-based twice.
- The Tree view alignment is presentational; its grid/chips/glyphs must remain.

## 10. Verification

- Unit tests: `data-line`, `--ln-digits`, `.document` wrapper, token variables, gutter/fold CSS,
  selection/tint (no `--ecuc-selection-fg`), strip markup, target hover, empty-state comment,
  details width/copy, narrow rules.
- Existing suites: editing, filter, reveal, references, rescan, accessibility, node identity.
- Capture matrix: Document dark/light/HC selected/focused, editing/invalid, collapsed, details
  selected/empty, narrow 360px, Tree dark.
- Harness: `npm run preview:ecuc`, `?view=document|tree&theme=light|dark|hc&chrome=0`.
- Gates: `npm run check-types`, `npm run lint`, `npm test`, `npm run preview:check`.
- Then `@code-review` against `docs/ECUC_EDITOR_DESIGN_SPEC.md`; the spec is read-only and must not be
  edited.

## 11. Rollback

Revert the renderer/CSS/script changes; the core, provider, write path and state keys are untouched.
The only renderer data addition is `data-line`/`--ln-digits`/`.document`; removing them restores the
previous Document view. No setting/migration is involved.
