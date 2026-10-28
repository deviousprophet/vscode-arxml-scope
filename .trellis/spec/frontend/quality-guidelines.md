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
- **The value widget's listeners stay first, and claim their events with `stopImmediatePropagation`.**
  The tree and the filter must not act on a click or key the widget owns; the ordering is asserted.
- **Anything that must survive a re-scan lives outside the row window.** The shell, toolbar and
  inspector are not rebuilt; the row store, display list and window are. The filter's empty state is
  beside the tree because it describes the filtered list.
- **Only the viewport window is in the DOM.** `calcVisibleRange` over `displayRows` plus the small
  overscan drives `renderWindow`; top/bottom spacers carry the rest of `calcTotalHeight`. Do not
  "hide" offscreen rows — they were never built.
- **Rows are data, then text nodes.** The host emits `EcucRow` values; the page builds labels and
  values with `textContent`. Never use `innerHTML` for model text, and never reuse a full-tree HTML
  string as the re-scan payload.
- **Selection never recolours syntax.** Tree and Document selection use the translucent `--sel-bg`/
  `--sel-bg-focus` tint and the 2px `--rail` focus edge; the token colours stay. The light theme uses
  no fill because the light key accent measures 4.51:1 on white — the active line number (Document)
  and, when focused, the 2px rail carry the selection there. Do not reintroduce `--ecuc-selection-fg`
  or a monochrome selected line. Measure the tint contrast (the old light-theme green on the blue
  selection was 1.33:1); high contrast uses outlines, not fills.
- **`.value` stays a direct child of `.row`.** The widget, `highlightableSpans` and the editing tests
  select `:scope > .row > .value`; a wrapper cell breaks them. The value now contains a `--tok-punct`
  `=` and a `.value-text`; the widget hides `.value-text` and inserts the input inside `.value`, so the
  separator stays visible while editing. The filter highlights `.value .value-text`.
- **A fixed label track keeps values aligned.** In Tree view each row is its own grid; a per-row `1fr`
  label sizes to content and breaks the column. Document view deliberately drops the fixed track and
  the two-line grid; do not reintroduce chips, cards, ellipsized values or per-row accents there.
- **Document view is a presentation mode, not a data mode.** It is one `data-view` attribute and CSS
  scoped under `body[data-view="document"]`, over the same rows and virtual window. The same rows,
  roles, ids, `matchRanges`, filter/collapse state and `.value` direct-child contract apply. Never
  hide metadata (`.row-meta`) to make the document look clean; inline it. The product never reads or
  writes `.artext` and never runs `mmx`.
- **The Document surface is text first.** Structural labels are neutral; only `--tok-*` keywords,
  strings, numbers, meta, comments and the single key accent carry colour. Reference targets are plain
  until hover; values have no dotted underline or hover pencil. Use real source line numbers
  (`data-line`, with `#tree data-ln-digits` selecting the gutter width), the `--ln-w`/`--gut`/
  `--indent` gutter, the fold column and the 26px strip. The `=` is punctuation, not part of the value
  token. The tree's per-kind colours, chips, dotted values and blue underlined targets belong to Tree
  view, not Document view.
- **Defaults are Document view and hidden details.** `renderHtml` writes `data-view="document"`, the
  inspector `hidden`, and `aria-pressed="false"`; the page script applies a saved Tree view or a
  shown inspector. The view and details state share the validated webview state object; a missing or
  invalid view falls back to `document`.
- **Tree view keeps the ARTEXT scopes.** `data-value-kind` selects numeric/textual/boolean tokens;
  short names use `--tok-string`; targets are neutral with a hover link/underline. Do not paint every
  value with one token. The Tree kinds keep module/namespace/field/reference `symbolIcon` accents,
  glyphs, chips and dotted values. Document view uses the restrained palette above.
- **A re-scan keeps state, not markup.** The host posts rows; the page reconciles selection, collapse,
  query, view and scroll, rebuilds the display list and renders the window. There is no `innerHTML`
  tree swap and no second refresh path.
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
