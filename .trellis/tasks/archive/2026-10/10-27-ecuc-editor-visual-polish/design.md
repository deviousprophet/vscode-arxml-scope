# Design: ECUC editor visual preview and UI polish

Read with `prd.md`. The contracts this must not break are in
`../10-14-ecuc-editor-ux/design.md` (interaction model, state preservation, ids),
`../10-14-artext-custom-editor/design.md` (the provider, protocol, reveal, parent §6 display rules)
and `../10-14-ecuc-value-editing/design.md` (the widget's claim on click and key events).

## 1. Preview harness

### 1.1 Why a browser harness

The test host has no webview DOM, so the existing tests can only assert strings. A browser page can
show the real layout, hover, focus, scroll, themes and long values. It cannot prove VS Code's own
theme-variable resolution or a real custom-editor tab, so the harness is evidence with a stated
boundary, not a replacement for the manual Extension Development Host rows.

### 1.2 Shape

```
scripts/preview-ecuc.js          plain Node, built-ins only; server + page wrapper + --check
out/editor/renderHtml.js         the production renderer, from `npm run compile-tests`
out/core/ecuc/scanner.js         the production scanner
out/core/text/offsets.js         LineIndex for source positions
src/test/fixtures/**/*.arxml     synthetic fixtures (read only)
```

`package.json`:

```json
"preview:ecuc": "npm run compile-tests && node scripts/preview-ecuc.js",
"preview:check": "npm run compile-tests && node scripts/preview-ecuc.js --check"
```

The script does **not** live under `src/`, is not imported by `src/extension.ts`, and is not part of
`dist/extension.js`. It requires the `out/` build so it runs the same renderer the tests and the
extension use. It fails with a clear message when `out/` is missing.

### 1.3 Request flow

1. `GET /` or `/preview?fixture=<name>&theme=<light|dark|hc>&sort=<all|declaration>`.
2. Resolve `fixture` against a whitelist built by walking `src/test/fixtures/**` for `.arxml` files.
   Reject anything that is not one of those absolute paths (no `..`, no absolute input).
3. `text = readFileSync(path, 'utf8')`; `model = scanEcucValues(text)`.
4. `html = renderHtml(model, { nonce, sort, lineIndex: new LineIndex(text) })`.
5. `page = wrap(html, { fixture, theme, sort, fixtures, model, text })`.
6. Respond `200 text/html`. `GET /health` responds `ok`; unknown paths respond `404`.

The server binds to `127.0.0.1` on port `4173` by default, and scans upward for a free port when it is
occupied. It logs the URL it is serving. It never serves arbitrary files or a directory listing.

### 1.4 What the wrapper adds

The wrapper is additive and outside the page's `#main`/`#inspector` regions:

- **Theme style.** A `<style nonce>` after the page's style defining the `--vscode-*` variables for
  `light`, `dark` and `hc` (VS Code Default Light+, Default Dark+ and High Contrast approximations),
  plus `color-scheme`. `data-preview-theme` on `<html>` names the current preset.
- **Host stub.** A `<script nonce>` in `<head>` defining `window.acquireVsCodeApi()` before the page's
  inline script runs. It returns `{ postMessage, getState, setState }`; `postMessage` records the
  message in a log and, for `copy`, writes to the real browser clipboard when available (falling back
  to a log entry). It does not pretend to validate or write a document.
- **Preview panel.** A fixed, collapsible panel with fixture/theme/sort selects, Re-scan, Re-scan with
  value change, notice buttons, Clear log, and the message log. It is excluded by `?chrome=0` for
  clean screenshots. It uses the same nonce and attaches listeners with `addEventListener` (no inline
  handlers under the CSP).
- **Re-scan simulation.** The panel posts `{ type: 'model', tree, selectedId }` exactly as the host
  does. "Same model" reuses the current `#main` inner HTML; "value change" clones it, changes the
  first parameter's rendered text, and posts the clone. The collapsed set lives in the page and is
  the thing under test; the harness does not touch it.
- **Line index.** The wrapper passes `lineIndex` to `renderHtml`; the data attributes are therefore the
  same ones the real provider produces.

### 1.5 `--check`

`node scripts/preview-ecuc.js --check`:

- renders every whitelisted fixture × theme and asserts the result contains the real tree, the stub,
  `data-preview-theme`, the inspector shell, and no `undefined`;
- starts the server on port `0`, fetches `/health` and `/preview` over HTTP, asserts `200` and a real
  tree, then closes it;
- asserts the fixture whitelist rejects a traversal attempt and that `package.json` has no
  `dependencies`;
- prints one line per check and exits non-zero on the first failure.

It is the harness's regression test; it needs no browser.

## 2. Page shell and details inspector

### 2.1 Layout

```
body (column, height 100%)
  .toolbar
  #content (row, flex: 1, min-height: 0)
    #main (flex: 1, overflow: auto)          ← the existing scroll container
    #inspector (aside, 300px, overflow: auto)
```

`#main` keeps its id and its scroll semantics, so `reRenderTree`'s `readScrollTop`/`writeScrollTop`
continue to work. `#content` needs `min-height: 0` or the flex child will not scroll. On narrow
panels a media query stacks the inspector below the tree with a top border and a max-height.

`#inspector` is rendered by `renderHtml` (not `renderTree`), so it survives the provider's
`main.innerHTML = tree` swap. The empty state is in `renderTree` because it belongs to the filtered
tree.

### 2.2 Data model for the inspector

No host round-trip is needed. `item()` writes the data the inspector needs onto the tree item:

| Attribute | Source |
|---|---|
| `data-kind` | already present |
| `data-definition-ref` | the node's `definitionRef` |
| `data-short-name` | `shortName` where the model has one |
| `data-value` | a parameter's raw display value (already present) |
| `data-target` | a reference's raw target path |
| `data-line` / `data-column` / `data-end-line` / `data-end-column` | `LineIndex.positionAt(range.start/end)`, 0-based |

The raw `range` is used to compute the four line/column attributes; it is not emitted separately
(no consumer reads it). The inspector reads primary identity from those data attributes and the
secondary fields — `.short`, `.variant`, `.hex`, `.context`, `.condition`, `.annotation` — from the
rendered `.row-meta` spans. Those spans are the single rendered source; the webview does not
re-derive them from the model. It builds DOM nodes with `textContent` (never `innerHTML` from model
text), so a value containing `<` cannot inject markup.

### 2.3 Inspector content

- Header: kind badge (Module / Container / Parameter / Reference) and the primary label.
- Full `DEFINITION-REF` in a wrapping monospace block.
- Short name and variant, when present.
- Parameter value and hexadecimal form; reference target and context.
- Conditions and annotations, one per line, with their existing text.
- Source: `Lstart:col - Lend:col` (1-based for display).
- Actions: **Reveal in source**, **Copy path**, **Copy value** (or **Copy target** for a reference;
  the copy buttons are hidden when
  there is no path/value).
- Empty state when nothing is selected: a short hint and the module/package summary remains in the
  tree header.

The inspector is `role="region"` with `aria-label="Node details"`. It is not an `aria-live` region:
selection is already announced by the tree, and repeating a whole panel on every arrow key would be
noise.

### 2.4 Updating it

- `setSelection` calls `updateInspector()` after writing `aria-selected`.
- The `model` handler calls `updateInspector()` after `reRenderTree`.
- The initial `prepareFocus()` path calls it once.
- `updateInspector` is a no-op when the inspector is hidden; when it is shown again, it re-reads the
  selected item.
- Hiding/showing is a toolbar button with `aria-pressed` and `aria-controls="inspector"`. The
  `hidden` attribute is the single state; CSS does not guess.

## 3. Row grid and the contracts it must keep

### 3.1 Markup

`item()` changes from a flat `spec.meta` list to:

```html
<span class="row k-parameter has-value">
  <span class="twisty">…</span><span class="glyph">…</span>
  <span class="label">Name</span>
  <span class="value" title="Click to edit, or press F2">= 42</span>
  <span class="meta"><span class="hex">(= 0x2A)</span><span class="condition">…</span></span>
</span>
```

- `.value` stays a **direct child of `.row`**. `src/editor/ecucValueEditor.ts`,
  `src/editor/filter.ts` (`highlightableSpans`) and `editing.test.ts` select
  `:scope > .row > .value`; a wrapper would break all three.
- `.row-meta` is a new direct child wrapping the secondary text. `highlightableSpans` changes to
  `:scope > .row > .label, :scope > .row > .row-meta .short, :scope > .row > .value`. The `.short`
  span moves inside `.row-meta`, so its selector and the filter tests must be updated deliberately,
  not silently. (The class is `.row-meta`, not `.meta`, because `.meta` is already the
  schema/package container in `renderTree`.)
- `has-value` / `no-value` on `.row` lets CSS span the label across the value column for
  modules/containers. No `:has()` dependency.
- The node's `title` remains the full `DEFINITION-REF` (the pre-existing hover contract). Long labels
  and values get their own `title` only where the text can be clipped.

### 3.2 CSS

```css
.row {
  display: grid;
  grid-template-columns: 12px 12px 26ch minmax(0, 1fr);
  column-gap: 6px; row-gap: 1px; align-items: center;
  padding: 2px 8px 2px 4px;
}
.label { grid-column: 3; grid-row: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.value { grid-column: 4; grid-row: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-meta {
  grid-column: 3 / -1; grid-row: 2;
  display: flex; flex-wrap: wrap; gap: 2px 8px;
  min-width: 0; font-size: 0.9em; color: var(--vscode-descriptionForeground);
}
.row.no-value .label { grid-column: 3 / -1; }
```

The label column is a **fixed** `26ch`, not a `1fr`. Each row is its own grid, so a `1fr` label
would size to that row's content and the value column would start at a different x on every row — the
baseline's alignment would be lost. A trailing `auto` column for the hex has the same problem: rows
without a hex would give the value column more space. The hex therefore lives in `.row-meta`, and the
value column is the one remaining track. A module/container row has no value, so its label spans both
tracks and the full path gets the width it needs.

`grid-template-rows` is implicit: an empty `.row-meta` collapses, so a leaf without metadata stays
one line. `min-width: 0` on the grid children is what makes ellipsis work inside a grid.

The kind accent moves from `border-left` on `.row` to a coloured glyph and a subtle left border on the
row itself, so it does not compete with the indent guides. The exact colours stay `--vscode-symbolIcon-*`
variables with fallbacks.

### 3.3 Filter interaction

`applyFilter` still hides items by `style.display` and expands ancestors through `applyCollapsed`.
The `<mark>` highlighting must now walk into `.row-meta .short`; the value and label stay direct. The
`filterTree`/`matchRanges` host logic is untouched.

## 4. Source positions

`RenderOptions` gains `lineIndex?: LineIndex` (from `src/core/text/offsets.ts`). `Ctx` carries it;
`ItemSpec` gains `range`. `item()` emits the four line/column attributes when a line index is
present; the raw range is not emitted. The provider constructs a new `LineIndex(document.getText())`
for the first paint and again inside
`push()`, because the text may have changed. The preview harness does the same.

`LineIndex` is 0-based, matching VS Code `Position`; the inspector displays 1-based values. Tests
assert the raw data attributes against a known fixture offset, and the display conversion is a one-line
script function (`line + 1`, `column + 1`).

## 5. Copy message

`WebviewMessage` gains `text?: string`. The provider handles:

```ts
if (message.type === 'copy' && typeof message.text === 'string') {
  const notice = await copyText(vscode.env.clipboard, message.text);
  await panel.webview.postMessage({ type: 'notice', message: notice });
}
```

`copyText` is a small exported function in `src/editor/clipboard.ts`:

```ts
export async function copyText(
  clipboard: { writeText(text: string): Thenable<void> },
  text: string
): Promise<string> {
  await clipboard.writeText(text);
  return 'Copied to clipboard.';
}
```

It is testable with a stub, so the behavioural assertion is "the exact text reached the clipboard
interface", not "the handler exists". It is not a document write and does not touch `src/core/**`.
The webview buttons post only text the user can already see; the provider does not eval or open it.

## 6. Toolbar, count and empty state

- **Filter clear.** A `.filter-wrap` contains the input and a small `#filter-clear` button. The button
  is `hidden` while the input is empty; `applyFilter` updates it. Clicking it clears the input,
  dispatches the same `applyFilter`, and focuses the input.
- **Count badge.** `countLabel.dataset.state` is `none` (empty query), `filtered` (`shown of total`) or
  `empty` (`No matches`). CSS gives the badge a theme background only when it has content; the
  screen-reader text is unchanged.
- **Empty state.** `renderTree` appends:

  ```html
  <div id="empty" class="empty" hidden>
    <p id="empty-text"></p>
    <button id="empty-clear" type="button">Clear filter</button>
  </div>
  ```

  `applyFilter` queries `#empty` fresh on every call (the previous element was swapped away), sets
  `hidden`, and writes `No matches for "<query>".` with `textContent`. The clear action is delegated
  from `document`, so it survives a re-render. Clearing still restores the collapsed set because the
  collapsed set is never assigned by the filter; it only passes an `ancestors` override to
  `applyCollapsed`.
- **Toolbar controls.** Expand all, collapse all and the details toggle are text controls with
  `title`/`aria-label`s and a `:focus-visible` ring. Icon-only controls were not used, so the labels
  stay explicit; the details toggle uses `aria-pressed`. The toolbar wraps at narrow widths instead
  of clipping.

## 7. Preview themes and real themes

The harness themes are approximations of VS Code's built-in themes, defined as CSS custom properties
in the wrapper. The production CSS stays variable-only; the harness supplies values for:
foreground/background, description, panel border, list hover/active/inactive selection and focus,
focus border, input, button primary/secondary, icon, the four `symbolIcon-*` accents, indent guides,
find match, warning/error, font family/size and editor font family. High contrast also defines the
contrast border variables.

The production page must not depend on the harness theme: every variable has a usable fallback, and
`font-family`/`font-size` fall back to a system stack/13px. The harness theme is injected after the
page's style so it wins the cascade without changing the page's own declarations.

## 8. Verification strategy and limits

| Layer | Evidence |
|---|---|
| Harness itself | `preview:check`: every fixture × theme, a live HTTP request, whitelist, no dependency |
| Markup/structure | mocha assertions on `renderHtml`/`renderTree`: inspector shell, grid classes, direct `.value`, data attributes, empty state, copy script |
| Source positions | a unit test with `LineIndex` over a fixture: exact `data-line`/`data-column` |
| Copy path | `copyText` with a stub clipboard: exact text reached it, notice returned |
| Interactions that need a DOM | in-app browser: click, filter, clear, toggle, re-scan, hover, focus, scroll; screenshots |
| Real VS Code webview | **not** replaced by the harness. The UX task's manual rows are updated with what the harness observed and what still needs an Extension Development Host |

Mutation checks are required for the new assertions: remove the inspector shell, the line data, the
empty state, the copy handler and the details toggle one at a time and confirm a test fails. The
visual rows are not "tests"; they are recorded observations with captures.

## 9. Files and rollback

**Added**

- `scripts/preview-ecuc.js`
- `src/editor/clipboard.ts`
- `src/test/editor/uxPolish.test.ts` (or a small set matching the existing per-topic naming)
- `src/test/editor/copy.test.ts` if the copy tests do not fit `uxPolish`
- `research/visual/**` captures for this task

**Modified**

- `src/editor/renderHtml.ts` (shell, grid, inspector, line data, empty state, CSS)
- `src/editor/filter.ts` (`highlightableSpans`, clear button, count state, empty state)
- `src/editor/ecucEditorProvider.ts` (`LineIndex`, copy message)
- `src/test/editor/*` selectors that assumed `.short` was a direct child of `.row`
- `package.json` (two dev scripts only; no dependencies)
- `docs/ECUC_EDITOR.md`

**Rollback.** The UI changes are additive within `src/editor/` plus one host message and two dev
scripts. If the grid or inspector proves wrong, revert `renderHtml.ts`/`filter.ts` together; the
harness and the copy helper are independent. `src/core/**` is untouched, so parsing, ordering and
validation cannot be affected. No setting is added, so there is no migration.

## 10. Wrong vs correct

**Wrong — copy from a second renderer.**

```ts
const preview = `<div class="node">…</div>`; // a hand-written preview
```

**Correct — wrap the production output.**

```ts
const html = renderHtml(model, { nonce, lineIndex: new LineIndex(text) });
const page = wrap(html, { theme, fixture, fixtures });
```

**Wrong — put the value behind a wrapper for the grid.**

```html
<span class="row"><span class="cell"><span class="value">= 42</span></span></span>
```

**Correct — keep the direct-child contract.**

```html
<span class="row has-value"><span class="label">…</span><span class="value">= 42</span><span class="meta">…</span></span>
```

**Wrong — rebuild the inspector with `innerHTML` from model text.**

```ts
inspector.innerHTML = `<code>${item.dataset.definitionRef}</code>`;
```

**Correct — build text nodes.**

```ts
const code = document.createElement('code');
code.textContent = item.dataset.definitionRef;
```

## 11. Local samples and benchmark

### 11.1 Generator

`scripts/generate-samples.js` is plain Node, built-ins only:

```text
default output: path.resolve(ROOT, '..', 'sample')   # D:\workspace\sample here
optional argument: node scripts/generate-samples.js <dir>
```

It writes a self-describing `README.md` and:

| File | Content | Approx. nodes |
|---|---|---|
| `minimal.arxml` | one module, one container, one parameter | 3 |
| `display-rules.arxml` | a copy of the committed `editor/render.arxml` display fixture | 9 |
| `references.arxml` | a copy of the committed `editor/navigation.arxml` reference fixture | 11 |
| `deep.arxml` | a copy of the committed core `deep.arxml` nesting fixture | 7 |
| `large.arxml` | 400 containers × 8 parameters + one reference each | ~4,000 |
| `huge.arxml` | 1,000 containers × 10 parameters + one reference each | ~12,000 |

The two large files are generated from an array of strings and one `writeFileSync` each; no random
data, no customer data, no cache. The sample directory is outside the repository and is not
committed; the generator refuses an output path inside the repository. The generator is committed so
the set is reproducible.

### 11.2 Harness inclusion

`discoverFixtures({ includeSamples })` walks the committed fixtures always, and additionally walks
`SAMPLE_ROOT` when `includeSamples` is true (or `PREVIEW_SAMPLE_DIR` points elsewhere). Sample ids are
prefixed `sample/`, so the preview panel can switch to `sample/large` / `sample/huge`. `startPreview`
includes them when the directory exists; `runCheck` never does, so CI remains deterministic and does
not depend on a local sample directory.

The sample page goes through the same `scanEcucValues` → `renderHtml` path; it is not a second
renderer. The server logs the build time and page size for each request so a large page can be
compared with a small one.

### 11.3 Benchmark

`scripts/bench-ecuc.js` (or `npm run perf:ecuc -- <file>`) requires `out/`, reads the file, and
measures with a warm-up plus three medians:

- file size and UTF-16 length;
- node count from the model;
- `scanEcucValues`, `buildNodeIndex`, `renderTree`, `renderHtml`; `renderHtml` calls `renderTree`,
  and both call `buildNodeIndex`, so the index line is the same work in isolation, not an additive
  phase;
- heap-used delta around the run and RSS after the run; neither is a peak high-water mark (Node
  exposes no per-phase high-water mark).

It prints a summary and exits non-zero if the file cannot be scanned. It does **not** measure browser
layout/paint: that is observed separately in the harness page for `sample/large` and `sample/huge`.
The benchmark is evidence, not a promise; no optimisation or virtualisation is added unless the
numbers show a problem.

## 12. Semantic element colours

`data-value-kind` on the parameter's value span distinguishes the three value types without changing
the `class="value"` prefix (the widget and filter selectors stay valid):

| Element | Selector | Theme variable(s) |
|---|---|---|
| Module accent | `.row.k-module`, `.g-module` | `--vscode-symbolIcon-moduleForeground` → class → foreground |
| Container accent | `.row.k-container`, `.g-container` | `--vscode-symbolIcon-namespaceForeground` → class → foreground |
| Parameter accent | `.row.k-parameter`, `.g-parameter` | `--vscode-symbolIcon-fieldForeground` → foreground |
| Reference accent | `.row.k-reference`, `.g-reference` | `--vscode-symbolIcon-referenceForeground` → foreground |
| Numeric value | `.value[data-value-kind="numeric"]` | `--vscode-symbolIcon-numberForeground` → field → foreground |
| Textual value | `.value[data-value-kind="textual"]` | `--vscode-symbolIcon-stringForeground` → foreground |
| Boolean value | `.value[data-value-kind="boolean"]` | `--vscode-symbolIcon-booleanForeground` → keyword → foreground |
| Reference target | `.value.target` | `--vscode-textLink-foreground` → reference → foreground |
| Short name | `.short` | `--vscode-symbolIcon-variableForeground` → string → foreground |
| Variant | `.variant` | `--vscode-symbolIcon-enumeratorForeground` → foreground |
| Condition | `.condition` | `--vscode-symbolIcon-keywordForeground` → foreground, chip border |
| Annotation | `.annotation` | `--vscode-descriptionForeground`, italic chip |
| Hex/context | `.hex`, `.context` | `--vscode-descriptionForeground` |

The existing selected-row rule (`.node[data-selected="true"] > .row > .value` and the `.row-meta`
spans) has higher specificity than the value-kind selectors and continues to force the theme's
selection foreground; the visual pass re-measures the ratios. The harness theme adds module,
namespace, variable and boolean values; real VS Code supplies them, with the fallback chain above
when a theme omits one. No colour literal is introduced outside a `var(...)` fallback.

**Wrong — one number colour for every value.**

```css
.value { color: var(--vscode-symbolIcon-numberForeground); }
```

**Correct — the value type chooses the variable.**

```css
.value[data-value-kind="textual"] { color: var(--vscode-symbolIcon-stringForeground, var(--vscode-foreground)); }
.value[data-value-kind="boolean"] { color: var(--vscode-symbolIcon-booleanForeground, var(--vscode-symbolIcon-keywordForeground, var(--vscode-foreground))); }
```

**Wrong — module and container share one accent.**

```css
.row.k-module, .row.k-container { border-left: 2px solid var(--vscode-symbolIcon-classForeground); }
```

**Correct — the kind picks the symbol icon.**

```css
.row.k-module { border-left-color: var(--vscode-symbolIcon-moduleForeground, var(--vscode-symbolIcon-classForeground)); }
.row.k-container { border-left-color: var(--vscode-symbolIcon-namespaceForeground, var(--vscode-symbolIcon-classForeground)); }
```

## 13. Additional files and rollback

Added: `scripts/generate-samples.js`, `scripts/bench-ecuc.js`, the generated `../sample/**` (outside
the repository), colour tests in `uxColors.test.ts`, and `research/visual/colors/**` captures.
Modified: `src/editor/renderHtml.ts` (value kinds and accents), `scripts/preview-ecuc.js` (optional
sample discovery and build timing), harness themes, `docs/ECUC_EDITOR.md`, task artifacts.

The colour pass is additive CSS plus a data attribute; roll it back by removing the value-kind
attributes and the new selectors, returning to the single `.value` colour. The sample generator and
benchmark are independent of the extension bundle. `src/core/**` is untouched, so the scanner and
write path cannot be affected.
