# CSS Guidelines

The webview has no CSS framework and no CSS-in-JS. Every stylesheet is a real `.css` file imported for
its side effect by the TypeScript module that owns it; esbuild emits one stylesheet per browser bundle.
These rules describe the stylesheets that ship in `dist/editorViewer.css` and `dist/diffViewer.css`.

## File Placement

| File | Content |
|---|---|
| `src/webview/styles/tokens.css` | Theme tokens and the fallback set for the Document surface and the diff. Imported first by both pages. |
| `src/webview/styles/base.css` | Reset, `body` layout, `#content` / `#main` boxes, `#tree-measure` probe host, `.sr-only`, `.grow` and the narrow layout. |
| `components/documentTree/documentTree.css` | `.document-tree*` shell, `.row`, `.label`, `.value`, `.row-meta`, `.twisty`, `.guide`, condition/annotation/mark styling, depth and high-contrast rules. |
| `components/diffView/diffView.css` | Diff page tokens, the `#diff-body` column, the `#diff-list` / `.diff-pane` grid, `.diff-row` / `.diff-cell` status tints, the empty state and pane header parity. |
| `components/toolbar/toolbar.css` | `.toolbar`, `.toolbar-left` / `-center` / `-right`, `.tool`, `.icon-tool`. |
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
| Geometry | `--fold-gutter: 26px`, `--doc-pad: 3ch`, `--indent: 4ch`, `--content-pad` | `--content-pad` is `calc(var(--fold-gutter) + var(--doc-pad))`; depth is generated from it. |
| Search | `--match-bg`, `--match-hi` | Fixed dark-theme yellow tiers (see the exception log). |
| Container accent | `--container-accent` | Fixed `#4EC9B0` (see the exception log). |

Rules:

- Every colour is a `--vscode-*` variable, or one of the documented tokens. A literal colour may appear
  only as a fallback **inside** `var(...)`, never as a standalone declaration value.
- Do not reach for `--vscode-editor-findMatch*` for search marks: a theme may resolve it to transparent.
  The page has one highlight implementation and two fixed tiers (`--match-bg`, `--match-hi`).
- Use the semantic token for the job: buttons use `--vscode-button-*`, borders use
  `--vscode-panel-border` / `--vscode-editorGroup-border`, focus uses `--vscode-focusBorder`, disabled
  text uses `--vscode-disabledForeground`.
- High contrast and forced colours override the visual treatment, not the token names: fills become
  outlines in `documentTree.css` and `diffView.css`.

## Selector Patterns

- **State is data.** Style from attributes the row builders already write:
  `[data-value-kind="numeric|textual|boolean"]`, `[data-selected="true"]`, `[data-subtree="true"]`,
  `[data-disabled="true"]`, `[data-search-current="true"]`, `[data-state="false"]`, `[data-empty="true"]`,
  `[data-gap="true"]`, `[data-level]`, `[aria-expanded]`, `[aria-invalid="true"]`. Do not add a class
  whose only purpose is to mirror state the DOM already carries.
- **Classes name structure.** `.row`, `.label`, `.value`, `.value-text`, `.row-meta`, `.twisty`,
  `.guide`, `.condition`, `.annotation`, `.comment`, `.document-tree-scroll`, `.diff-row`, `.diff-cell`,
  `.sb-section-head`, `.sb-body`. The row builders and the tests select these names; renaming one is a
  contract change.
- **IDs are singletons owned by the shell.** `#tree`, `#sidebar`, `#side-tabs`, `#row-menu`,
  `#diff-list`, `#diff-pane-left` / `#diff-pane-right`. A component that must support two instances
  takes a root selector (`DocumentTreeView('#diff-pane-left', 'left')`) and never queries a global id
  inside its own logic.
- Prefer shallow selectors and a scoped custom property over a long descendant chain. The generated
  depth rules are two levels (`body[data-view="document"] .row[data-level]`); the existing
  high-contrast/selection rules go deeper only because they must scope to a view, a tree and a state at
  once. Do not add a deeper chain for a new feature.
- Do not use `!important`. There are none in the shipped stylesheets; keep it that way.
- Do not style through `innerHTML` or inject markup. Rows are created with `createElement` /
  `textContent`; the only namespace-built SVG is the inline twisty.

## Layout Rules

### Virtual rows and the Document surface

- `.document-tree` is the component root: header, then `.document-tree-scroll` (native two-axis
  scroller), then `.document-tree-top`, `.document-tree-window` and `.document-tree-bottom`.
  The scroller is the only scroll container for the rows.
- The window is positioned by two spacer heights written as CSSOM custom properties on the scroller:
  `--document-tree-top` and `--document-tree-bottom`. The window's minimum width comes from
  `--document-tree-content-width`. Never set these as a `style` attribute in the markup.
- `.document-tree-scroll` keeps `overflow-anchor: none`, `scrollbar-gutter: stable`, the editor font
  stack, `font-variant-ligatures: none`, `tab-size: 4` and `white-space: pre`.
- A row is one flex line: `.row { display: flex; flex-wrap: nowrap; gap: 1ch; height: var(--ecuc-lh);
  padding-left: var(--content-pad); }`. `.value` is a direct child of `.row`.
- The fold gutter is fixed at 26px. `.twisty` is absolutely positioned at `left: 2px`, spans the row
  height and holds a 16px chevron. Leaves reserve the gutter but render no twisty.
- Depth comes from `data-level` and the generated rules in `documentTree.css`:
  `padding-left: calc(var(--content-pad) + var(--indent) * (level - 1))` for levels 1–24. Guides use the
  matching `.guide[data-level]` left offset plus `0.5ch`. No style attribute, no inline depth.
- `.row-meta` is the inline meta line, not the schema/package header (`.document-tree-meta`). It uses
  `gap: 1ch` and `white-space: pre`. A condition chip is bounded: `max-width: 56ch`, ellipsis, and its
  full text lives in `title`. The annotation chip is a comment row above its node, not inline meta.
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

- `#diff-body` is the flex column; `#diff-list` inside it is the two-pane grid, and `.diff-pane`
  instances are separated by the 3px divider. Each pane mounts its own `DocumentTreeView`, so each has
  its own `.document-tree-scroll`.
- Status is a tint on `.diff-row > .diff-cell[data-side="left|right"]`, driven by
  `[data-status="added|removed|changed"]`. The status tint never recolours syntax tokens.
- Both panes receive the same content width and row height. Pane headers repeat the Document
  `.document-tree-header` geometry so the rows align.

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
| No standalone literal colour | `tokens.css` `--match-bg: rgba(234, 179, 8, 0.32)` and `--match-hi: rgba(234, 179, 8, 0.7)` | Fixed two-tier search highlight; theme find-match variables may resolve to transparent. The tiers are deliberately independent of the theme. |
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
