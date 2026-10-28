# Quality Guidelines

Rules that every change in this repository must keep. Each one exists because breaking it has a cost
that is not obvious from the code.

## Forbidden patterns

| Never | Why |
|---|---|
| `import … from 'vscode'` under `src/core/**` | The core is a pure library over text; this is what keeps a future workspace index or language server possible. |
| A new runtime dependency | The core is dependency-free by design and the extension bundles with esbuild. Reach for the standard library or the platform first. |
| Writing a derived file, cache or index beside a user's file | The legacy tool did this and it is the main reason it is being replaced. Nothing but the `<VALUE>` text a user edited may be written. |
| Reintroducing the ARTEXT text form: a grammar, `Open as ARTEXT`, a text diff | ARTEXT survives only as the name of the information model. Anything that exists only because an external process produced a text file is dropped. |
| Generating an expected fixture from the code under test | A snapshot agrees with the code by construction. See `testing.md`. |
| Editing a committed fixture from a test | It passes once, then fails forever and silently rewrites the repository. |
| Hard-coded colours in the webview | Use the `--vscode-*` CSS variables so the editor follows the user's theme. |
| A second renderer or copied markup for a preview/harness | It diverges from the product; wrap the production `renderHtml` and assert containment. |
| Reading a real customer file from a test | The repository is public. Fixtures are synthetic. |
| Building the whole row list into the DOM | It restores the large-file lag; render the viewport window plus overscan only. |
| Setting row depth or spacer heights with a style attribute | The CSP blocks inline styles; use `data-level` CSS and the nonce-carrying `#virtual-style` sheet. |

## Rules the write path must keep

- **One `WorkspaceEdit` per user action.** One action is exactly one undo step. Do not batch two edits
  into one, and do not split one into two.
- **Validation runs before the write, always.** A refusal leaves the bytes untouched. Never skip
  validation to make a test pass — the refusal test exists to make that visible.
- **Write only inside the recomputed region.** Recompute it by re-scanning rather than replaying a
  stored offset: a value's length changes when it is edited, so every later offset shifts.
- **Refuse rather than guess.** If a region cannot be established safely (it no longer resolves, its
  bytes moved, it sits inside a CDATA section), refuse with a message. A refusal costs the user one
  action; a wrong write costs them their file.

## Rules the editor must keep

- **Never claim a file by default.** The custom editor's manifest `priority` is `"option"`; the
  default is `"default"`, which would take over every `.arxml`. Activation is explicit.
- **Dispose everything.** Every subscription and panel handler is disposed with its panel. A listener
  outliving its panel is a defect.
- **Re-scan after every change** instead of caching, so the view can never show a stale range that a
  later write would target.
- **A webview gets a CSP and a nonce**, and its state is re-posted on every change rather than assumed
  to survive.
- **The details editor owns its input events.** The value input lives in the details panel, outside
  `#tree`, and stops `Enter`/`Escape`/`Tab` propagation. The Document row handler only selects/opens
  the details editor; it never inserts an input into `.value`.
- **Anything that must survive a re-scan lives outside the row window.** The shell, toolbar and
  inspector are not rebuilt; the row store, display list and window are. The filter's empty state is
  beside the tree because it describes the filtered list.
- **Only the viewport window is in the DOM.** `calcVisibleRange` over `displayRows` plus the small
  overscan drives `renderWindow`; top/bottom spacers carry the rest of `calcTotalHeight`. Do not
  "hide" offscreen rows — they were never built.
- **Rows are data, then text nodes.** The host emits `EcucRow` values; the page builds labels and
  values with `textContent`. Never use `innerHTML` for model text, and never reuse a full-tree HTML
  string as the re-scan payload.
- **Selection never recolours syntax.** A selected parameter uses `--sel-bg-focus`, the 2px
  `--rail` and a 1px `--sel-outline`; a selected container/module also tints its visible subtree
  with `--subtree-bg`. Tokens keep their colours; high contrast uses outlines, not fills. Do not
  reintroduce `--ecuc-selection-fg` or a monochrome selected line.
- **`.value` stays a direct child of `.row`.** The filter and tests select `.row > .value`; a wrapper
  cell breaks them. The value contains a `--tok-punct` `=` and a `.value-text`; the document never
  inserts an input. The details input is a separate `.details-value` in the inspector.
- **One Document presentation.** There is no Tree toggle, view state, Tree grid/glyph/chip CSS or
  Tree row height. Do not reintroduce a hidden second view.
- **The Document surface is text first.** Structural labels are neutral; only `--tok-*` keywords,
  strings, numbers, meta, comments, the green container name, the yellow italic reference target and
  the single key accent carry colour. Unresolved reference targets are not links; resolved targets
  underline only on hover; values have no dotted underline or hover pencil. Use
  `--doc-pad`/`--indent`, the inline fold column and the 26px strip; there is no line-number gutter.
  The `=` is punctuation, not part of the value token.
- **No line-number gutter.** Do not add `data-line`, `data-ln-digits`, `--ln-*`, `--gut`, a digits
  payload or source-position fields back to the row model. Bracket guides are the only vertical
  rules; they run from opening to closing brace, fade at rest and activate on hover. A repeating
  indent gradient is forbidden.
- **Defaults are Document and hidden details.** `renderHtml` writes `data-view="document"`, the
  inspector `hidden`, and `aria-pressed="false"`; only `inspectorHidden` is persisted. An old saved
  `view` is ignored.
- **Details editing is the only value edit path.** A selected parameter's value input commits through
  the existing `{ type: 'edit', nodeId, value }` message; Enter commits, Escape restores, Tab moves.
  A refusal keeps the typed text, marks the input invalid and shows the reason. The panel exposes
  Reveal in source only; there is no Source block or copy action.
- **Dark is the supported theme for now.** Do not re-add a light-only selection/token branch or a
  light preview/capture; high contrast is the accessibility variant. High-contrast/forced-colors
  subtree rows use a dotted outline, not the fill.
- **The twisty hit area is the row.** The span stretches to `var(--ecuc-lh)`; do not shrink it back to
  the 12px icon, or clicking above/below the chevron starts selecting instead of toggling.
- **Reference follow is same-file only.** Only a target resolved through `resolvePath(model.pathIndex)`
  gets `followable`/`data-follow`. Following selects the target node in the ECUC editor; unresolved
  targets are not links.
- **Collapse controls stay findable.** The toolbar Collapse/Expand controls keep their labels at
  normal widths and the row twisty stays visible at rest; labels may hide only at <=720px.
- **A re-scan keeps state, not markup.** The host posts `{ type: 'model', rows, selectedId }`; the
  page reconciles selection, collapse, query and scroll, rebuilds the display list and renders the
  window. There is no `innerHTML` tree swap and no second refresh path.
- **The filter scans the row index, never the DOM.** `filterRows`/`flattenRows` provide the matches,
  their ancestors and the displayed list; only rendered rows get `<mark>` elements. The input
  debounces and a stale generation is discarded.
- **Samples and benchmarks are dev-only.** The sample directory is outside the repository and
  synthetic; `preview:check` excludes it. A benchmark is evidence, not a performance promise.

## Before calling work done

- `npm run check-types`, `npm run lint` and `npm test` are green.
- Every new assertion fails when its feature is deleted (`testing.md`).
- Anything that could not be verified in this environment is stated plainly as unverified — not
  implied to have passed.
