# CSS Guidelines

The webview has no CSS framework and no CSS-in-JS. Every stylesheet is a real `.css` file imported for
its side effect by the TypeScript module that owns it; esbuild emits one stylesheet per browser bundle.
These rules describe the stylesheets that ship in `dist/editorViewer.css` and `dist/diffViewer.css`.

## File Placement

| File | Content |
|---|---|
| `src/webview/styles/tokens.css` | Theme tokens and the fallback set for the Document surface and the diff. Imported first by both pages. |
| `src/webview/styles/base.css` | Reset, `body` layout, `#content` / `#main` boxes, `#tree-measure` probe host, `.sr-only`, `.grow` and the narrow layout. |
| `components/documentTree/documentTree.css` | `.document-tree*` shell (header, scroller, window, spacers, line-number gutter), `.row`, `.label`, `.value`, `.row-meta`, `.twisty`, `.guide`, condition/annotation/mark styling, depth and high-contrast rules. |
| `components/diffView/diffView.css` | Diff page tokens, the `#diff-body` column, the `#diff-list` / `.diff-pane` grid, `.diff-row` / `.diff-cell` status tints, `.word-changed` removed/inserted runs, the empty state and pane header parity. |
| `components/toolbar/toolbar.css` | `.toolbar`, `.toolbar-left` / `-center` / `-right`, `.tool`, `.diff-tool`. |
| `components/searchBar/searchBar.css` | `.search-box`, `.search-field`, `.search-input`, `.search-clear`, `.search-nav`, `.search-count`, `.search-progress`. |
| `components/sidebar/sidebar.css` | `#sidebar`, `#sidebar-resizer`, `#side-tabs`, `.stab`, `.sb-tab-panel`, `.sb-pane*`, `.sb-section-*` and the shared `.sb-btn*` / `.nav-btn` / `.act-btn` primitives. |
| `components/sidebar/detailsPanel/detailsPanel.css` | `#inspector`, `.inspector-*`, `.condition-code`, `.details-status`. |
| `components/sidebar/conditionsPanel/conditionsPanel.css` | `.conditions-panel`, `.conditions-*`, `.condition-row`, `.condition-*` field and action styles. |
| `components/contextMenu/contextMenu.css` | `.row-menu`, `.row-menu-item` and the delete variant. |
| `components/detailsEditor/detailsEditor.css` | `.details-value`, its focus/invalid states and `.details-value-error`. |

Rules:

- A component owns `<Component>/<component>.css`; its `.ts` imports the file (`import './searchBar.css';`).
  The page entrypoints import `styles/tokens.css` and `styles/base.css` before the components.
- `src/webview/styles/` holds only shared tokens, resets and layout boxes. It is not a grab-bag for a
  component's rules, and there is no `styles/index.ts` barrel.
- A new component gets its own folder and stylesheet; do not append its selectors to another component's
  CSS. Nested sidebar panels (`detailsPanel`, `conditionsPanel`) are the only components with their own
  CSS inside another component's folder, because the sidebar itself owns their host shell.
- No inline `<style>` block and no CSS in a TypeScript template string. The one exception is the
  per-open context-menu position, written as a nonce-scoped `<style id="row-menu-style">` element.
- Do not add a duplicate of a shared primitive. If a control needs the sidebar look, use `.sb-btn-*`
  from `sidebar.css`; if it needs a 28px icon action, use `.nav-btn` or `.act-btn`.

## Design Tokens

Tokens live in `tokens.css` on `body[data-view]`. Both pages set `data-view="document"`; the diff page
also sets `data-page="diff"`, which scopes its own surface tokens. Plain declarations come first; the
`@supports (color: ... color-mix(...))` block refines the derived colours for hosts that support it.

| Group | Tokens | Notes |
|---|---|---|
| Typography | `--ecuc-fs`, `--ecuc-lh` | `--ecuc-lh` is `calc(var(--ecuc-fs) * 1.55)`; the CSS and the page's `heightFn` must agree. |
| Syntax | `--tok-keyword`, `--tok-string`, `--tok-number`, `--tok-meta`, `--tok-comment`, `--tok-key`, `--tok-punct`, `--tok-dim` | Every value resolves from a `--vscode-*` token, with the editor foreground as the fallback. |
| Surfaces | `--hover-bg`, `--sel-bg`, `--sel-bg-focus`, `--subtree-bg`, `--sel-container-bg`, `--sel-outline`, `--rail` | Selection uses tint + rail; it never recolours syntax. |
| Geometry | `--fold-gutter: 26px`, `--line-numbers-width: 0px`, `--doc-pad: 3ch`, `--indent: 4ch`, `--content-pad` | `--content-pad` is `calc(var(--line-numbers-width) + var(--fold-gutter) + var(--doc-pad))`; depth is generated from it. `--line-numbers-width` is written per pane as `<chars>ch` and defaults to `0px`. |
| Search | `--match-bg`, `--match-hi` | Fixed amber tiers: 0.18 alpha for every hit, 0.36 for the current hit (see the exception log). |
| Container accent | `--container-accent` | Fixed `#4EC9B0` (see the exception log). |

Rules:

- Every colour is a `--vscode-*` variable, or one of the documented tokens. A literal colour may appear
  only as a fallback **inside** `var(...)`, never as a standalone declaration value.
- Do not reach for `--vscode-editor-findMatch*` for search marks: a theme may resolve it to transparent.
  The page has one highlight implementation and exactly two fixed amber tiers (`--match-bg` 0.18 for
  every hit, `--match-hi` 0.36 for the current match); the current tier must stay visibly stronger
  while the text remains readable.
- Use the semantic token for the job: buttons use `--vscode-button-*`, borders use
  `--vscode-panel-border` / `--vscode-editorGroup-border`, focus uses `--vscode-focusBorder`, disabled
  text uses `--vscode-disabledForeground`.
- High contrast and forced colours override the visual treatment, not the token names: fills become
  outlines in `documentTree.css` and `diffView.css`.

## Selector Patterns

- **State is data.** Style from attributes the row builders already write:
  `[data-value-kind="numeric|textual|boolean"]`, `[data-selected="true"]`, `[data-subtree="true"]`,
  `[data-disabled="true"]`, `[data-search-current="true"]`, `[data-state="false"]`, `[data-empty="true"]`,
  `[data-word-side="left|right"]`, `[data-level]`, `[aria-expanded]`,
  `[aria-invalid="true"]`. Do not add a class whose only purpose is to mirror state the DOM already
  carries.
- **Classes name structure.** `.row`, `.label`, `.value`, `.value-text`, `.row-meta`, `.twisty`,
  `.guide`, `.condition`, `.annotation`, `.comment`, `.virtual-scroll-vscroll`, `.virtual-scroll-content`,
  `.virtual-scroll-pane`, `.document-tree-window`, `.diff-row`, `.diff-cell`, `.word-changed`,
  `.sb-section-head`, `.sb-body`. The row builders and the tests select these names; renaming one is a
  contract change.
- **IDs are singletons owned by the shell.** `#tree`, `#sidebar`, `#side-tabs`, `#row-menu`,
  `#diff-list`, `#diff-title-left` / `#diff-title-right`. VirtualScroll creates the pane layers
  (`#diff-pane-left` / `#diff-pane-right`, `#tree-pane`); a window renderer takes the pane element, not
  a global id, and never queries a global id inside its own logic.
- Prefer shallow selectors and a scoped custom property over a long descendant chain. The generated
  depth rules are two levels (`body[data-view="document"] .row[data-level]`); the existing
  high-contrast/selection rules go deeper only because they must scope to a view, a tree and a state at
  once. Do not add a deeper chain for a new feature.
- Do not use `!important`. There are none in the shipped stylesheets; keep it that way.
- Do not style through `innerHTML` or inject markup. Rows are created with `createElement` /
  `textContent`; the only namespace-built SVG is the inline twisty.

## Layout Rules

### Virtual rows and the Document surface

- `.virtual-scroll` is the component root; inside it, `.virtual-scroll-vscroll` is the native vertical
  scroller and the only vertical scroll container. Its content is `.virtual-scroll-content`, whose
  height is the precomputed content length; one `.virtual-scroll-pane` per view holds the absolutely
  positioned `.document-tree-window`. The horizontal bars are `.virtual-scroll-hbars` with one
  `.virtual-scroll-hscroll` per pane and a `.virtual-scroll-hspacer` of that pane's content width.
- `.document-tree-window` is positioned at `offsets[start]`, sized to the rendered slice and translated
  by the shared horizontal offset. Its `min-width` is `max(100%, var(--document-tree-content-width, 0px))`:
  at least the pane, at least the full content estimate. That single rule is what makes the selection and
  subtree fills span a stable width; never narrow it to the rendered slice or set these as a `style`
  attribute in the markup.
- `.document-tree-pane` and `.row` declare `user-select: text` so row text supports native
  selection and copy with no custom handler. `.document-tree-lines`, `.twisty`, `.guide`,
  `.document-tree-header-gap`/`.document-tree-module-gap` and sidebar chrome declare
  `user-select: none`; keep the gutter text out of copied output.
- `.document-tree-lines` is a sibling after the window, inside the pane. It is absolutely positioned,
  full pane height, `width: var(--line-numbers-width)`, `overflow: hidden`, `z-index: 1`,
  `aria-hidden="true"` and `user-select: none`. One `.document-tree-line-number` cell per rendered row is
  placed with the CSSOM `top`/`height` from the shared offsets; the pane publishes
  `--line-numbers-width: <max(digits, 5)>ch` (`0ch` for an empty model) and redeclares
  `--content-pad` from it, because `var()` inside a custom property is substituted where the
  property is declared, not where it is used. The gutter is never translated,
  so horizontal panning leaves it fixed; the window scrolls underneath its opaque
  `editorGutter.background`. The Document gutter repeats the row's 2px selection and focus rails on the
  numbered cell (`data-active`, `data-focused`) because the opaque column covers the row's leading edge.
- `.virtual-scroll-vscroll` keeps `overflow-anchor: none`, `scrollbar-gutter: stable`, the editor font
  stack, `font-variant-ligatures: none`, `tab-size: 4` and `white-space: pre`. Header rows use the same
  `.row` geometry; they are content, not a pinned block.
- A row is one flex line: `.row { display: flex; flex-wrap: nowrap; gap: 1ch; height: var(--ecuc-lh);
  padding-left: var(--content-pad); }`. `.value` is a direct child of `.row`.
- The fold gutter is fixed at 26px. `.twisty` is absolutely positioned at
  `left: calc(var(--line-numbers-width) + 2px)`, spans the row height and holds a 16px chevron. Leaves
  reserve the gutter but render no twisty.
- Depth comes from `data-level` and the generated rules in `documentTree.css`:
  `padding-left: calc(var(--content-pad) + var(--indent) * (level - 1))` for levels 1–24. Guides use the
  matching `.guide[data-level]` left offset plus `0.5ch`. No style attribute, no inline depth.
- `.row-meta` is the inline meta line, not a schema/package row. It uses
  `gap: 1ch` and `white-space: pre`. A condition chip is bounded: `max-width: 56ch`, ellipsis, and its
  full text lives in `title`. The annotation chip is a comment row above its node, not inline meta.
  A selected subtree tints `.node[data-subtree="true"] > .row`, `.brace[data-subtree="true"] > .row`
  and `.comment[data-subtree="true"] > .row`; the comment node itself stays `aria-hidden` and carries
  no focus.
- The schema/package header ends with one blank host row at `--ecuc-lh`. It has no rule child, border,
  gradient or separator decoration; it is numbered like any other display line.
- Every module group after the first starts with one blank host row at `--ecuc-lh` (the module gap). It
  shares the header-gap rule (`.document-tree-header-gap, .document-tree-module-gap`), so both use the
  same height and content padding and neither gets a rule, border, gradient, hover, selection or tint.
  There is no `[data-gap]` padding: the gap is a real row and the row count owns its height.
- Empty containers show a muted `{ }` via `.node[data-kind="container"][data-empty="true"] > .row::after`;
  a collapsed container shows ` { … }`. These are CSS content, not markup.
- Under `@media (max-width: 720px)` the document narrows `--doc-pad` to `2.5ch` and `--indent` to `3ch`;
  the row geometry still comes from the same custom properties.

### Sidebar

- `#sidebar` is a fixed-width flex column driven by `--sidebar-w` (default 360px) with a 6px
  `#sidebar-resizer` on its left. The editor keeps the resizer outside the panel so a drag never
  reflows the row window.
- `#side-tabs` is a 28px vertical strip. `.stab` uses `writing-mode: vertical-rl`, 10px bold uppercase
  and a 3px active edge. At `<=720px` the strip becomes horizontal and the whole sidebar moves below
  the document with `max-height: 45vh`.
- The tier is a PaneView: `.sb-pane-view` > `.sb-pane` (`.sb-section`) > `.sb-section-head` +
  `.sb-body`, with `.sb-pane-sash` between panes. The header is exactly 22px; the body is the only
  scroller (`overflow-y: auto; overflow-x: hidden`).
- `flex-basis` is driven by `--sb-pane-h`; a drag or collapse changes the pane, not the body's content
  height. `.sb-pane-sash` is 6px and gets `.disabled` next to a collapsed pane.
- `.sb-section-label` is the 11px bold uppercase title. `.sb-section-actions` stops click propagation
  so header actions never toggle the section.

### Diff

- `#diff-body` is the flex column; the fixed `.diff-title-strip` sits above `#diff-list`, which mounts
  one `VirtualScroll` with two pane layers. Each pane mounts a `DocumentTreeView` window renderer, so
  there is one vertical bar and one horizontal bar per pane, and the pane split stays fixed. Header rows
  are the
  first virtual rows; both panes pad the shorter header to the same line count and share one offsets
  table, so the first compared row starts at the same y.
- Status is a tint on `.diff-row > .diff-cell[data-side="left|right"]`, driven by
  `[data-status="added|removed|changed"]`. The status tint never recolours syntax tokens.
- Both panes show the shared blank `.diff-module-gap-row` before every module after the first: one
  `--ecuc-lh` high, editor background, no cell, tint, rail, border or word span. It is not a change row.
- A changed row's changed words are `.word-changed[data-word-side="left|right"]`. The left pane uses
  `--vscode-diffEditor-removedTextBackground` (fallback `--diff-removed-bg`) with a 1px
  `--diff-removed-edge` outline; the right pane uses `--vscode-diffEditor-insertedTextBackground`
  (fallback `--diff-added-bg`) with a 1px `--diff-added-edge` outline. A search `<mark>` inside one
  keeps `--match-bg` (or `--match-hi` when current); the calmer fill never erases the word span's
  outline. Forced-colors and high contrast replace both fills with a dotted outline.
- Both panes share the same row height, offsets and text content width; each pane's horizontal extent
  adds its own number column (`diffContent + chars * chWidth`), so the last characters stay reachable.
  Header rows use the Document `.document-tree-header-row` geometry and the shorter header is padded so
  the rows align. `diffContent` is computed over every row and header line, and the pane window keeps
  `min-width: max(100%, ...)`, so a short selected row still fills the pane.
- Each pane numbers its own display lines in a fixed gutter. A padded header line or a row missing on
  that side leaves the cell blank; hidden unchanged-run rows are not numbered. The module gap is
  numbered on both sides; header/gap/comment and brace lines are numbered. The gutter cell reuses the
  `diffEditorGutter-*` tint with the diff line-background fallbacks and redraws the pane-side rails
  hidden under the overlay (left changed/removed, right added).
- The header gap is one blank row with no rule child or border, numbered on both sides. The module gap
  shares that treatment, adds no cell and never carries a status attribute.

## Build and Bundle

- `esbuild.js` builds three outputs: the Node `dist/extension.js` and the browser entries
  `src/webview/editorViewer.ts` → `dist/editorViewer.js` and `src/webview/diffViewer.ts` →
  `dist/diffViewer.js`. The imported CSS is emitted by esbuild next to each browser bundle as
  `dist/editorViewer.css` and `dist/diffViewer.css`.
- The extension bundle uses the `ignore-css` plugin: importing a component's `.ts` from the host (for
  its static HTML builder) must not emit a CSS artifact beside `extension.js`.
- `src/host/webviewShell.ts` writes the static shell. `editorShell` and `diffShell` receive
  `scriptUri` / `styleUri` from `asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', ...))` and a
  per-panel nonce. The CSP is `default-src 'none'; style-src <cspSource> 'nonce-…'; script-src 'nonce-…';
  img-src <cspSource> data:`.
- Tests run from `out/`. `src/test/webview/cssImportHook.ts` (required by `.vscode-test.mjs`) installs a
  no-op `require.extensions['.css']` handler and mirrors every `src/webview/**/*.css` into the compiled
  `out/webview` tree. A new component stylesheet needs no hook change; deleting one leaves a harmless
  stale empty file until `out/` is cleaned.

## Exception Log

Documented deviations from the token/fallback rules. Add an entry before introducing another literal.

| Rule | Exception | Reason |
|---|---|---|
| No standalone literal colour | `tokens.css` `--container-accent: #4EC9B0` | Some themes resolve `--vscode-symbolIcon-*` to the regular foreground, which erases the container accent. High contrast/forced colours override it to the editor foreground. |
| No standalone literal colour | `tokens.css` `--match-bg: rgba(234, 179, 8, 0.18)` and `--match-hi: rgba(234, 179, 8, 0.36)` | Fixed two-tier search highlight; theme find-match variables may resolve to transparent. The tiers are deliberately independent of the theme, and the current tier stays stronger. |
| Literal only inside `var(...)` | `documentTree.css` `.guide` fallback `#80808040` | `--vscode-tree-indentGuidesStroke` may be absent; the translucent grey keeps guides visible without inventing a theme colour. |
| Literal only inside `var(...)` | `documentTree.css` reference target fallback `#DCDCAA` | `--vscode-symbolIcon-functionForeground` carries the reference yellow when the theme defines it; the fixed fallback preserves the distinction otherwise. |
| No literal colour for diff status | `diffView.css` uses `--vscode-diffEditor-*` and `--vscode-gitDecoration-*` with `transparent` / `currentColor` fallbacks | Diff status is theme-owned; the fallbacks are non-colours, not a palette. |

## Wrong vs Correct

```html
<!-- Wrong: CSP blocks the style attribute, and the depth CSS cannot follow the value. -->
<div class="node" data-kind="parameter" style="padding-left: 42px">
  <div class="row"><span class="label">Timeout</span></div>
</div>

<!-- Correct: depth is data; the generated CSS owns the geometry. -->
<div class="node" data-kind="parameter" data-level="3">
  <div class="row"><span class="label">Timeout</span></div>
</div>
```

```ts
// Wrong: a second, hand-written colour and a style attribute for the virtual spacer.
element.style.color = '#4EC9B0';
top.style.height = '120px';

// Correct: consume the token; write the component's scoped CSSOM properties.
element.classList.add('condition');
this.scroll.style.setProperty('--document-tree-top', '120px');
```

```css
/* Wrong: a one-off button and a hard-coded colour. */
.toolbar-save { color: #fff; background: #0a7; }

/* Correct: the shared primitive, themed by variables. */
.toolbar-save { /* use .sb-btn .sb-btn-primary from sidebar.css */ }
```
