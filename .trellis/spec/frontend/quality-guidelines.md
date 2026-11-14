# Quality Guidelines

Rules that every change in this repository must keep. Each one exists because breaking it has a cost
that is not obvious from the code.

## Forbidden patterns

| Never | Why |
|---|---|
| `import … from 'vscode'` under `src/core/**` | The core is a pure library over text; this is what keeps a future workspace index or language server possible. |
| A new runtime dependency | The core is dependency-free by design and the extension bundles with esbuild. Reach for the standard library or the platform first. |
| Writing a derived file, cache or index beside a user's file | The legacy tool did this and it is the main reason it is being replaced. Nothing but the text of the element the user edited (`<VALUE>`, `<SHORT-NAME>` or `<DEFINITION-REF>`) may be written. The workspace index lives in memory only. |
| Persisting the workspace index or a parse cache | The v0.5 index is rebuilt on activation from the workspace. A cache file, a `.codegraph`-style side directory or an extension-storage blob is not the v0.5 design; add persistence only with an explicit schema and invalidation story. |
| Resolving an ambiguous definition or element path | Exact path first, then a unique suffix. Two matches must resolve to nothing; a guessed definition would show a wrong type or range as fact. |
| Reintroducing the ARTEXT text form: a grammar, `Open as ARTEXT`, a text diff | ARTEXT survives only as the name of the information model. Anything that exists only because an external process produced a text file is dropped. |
| Generating an expected fixture from the code under test | A snapshot agrees with the code by construction. See `testing.md`. |
| Editing a committed fixture from a test | It passes once, then fails forever and silently rewrites the repository. |
| Hard-coded colours in the webview | Use the `--vscode-*` CSS variables so the editor follows the user's theme. The fixed `--container-accent` and the fixed search match tiers (`--match-bg`/`--match-hi`) are the documented dark-pass exceptions. |
| A second renderer or copied markup for a preview | It diverges from the product; wrap the production shell (`editorShell` / `diffShell`) and its bundled page, and assert containment. |
| Reading a real customer file from a test | The repository is public. Fixtures are synthetic. |
| Building the whole row list into the DOM | It restores the large-file lag; render the viewport window plus overscan only. |
| Setting row depth or spacer heights with a style attribute | The CSP blocks inline styles; use `data-level` CSS and the component's scoped CSSOM/spacer properties. |

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
  inspector are not rebuilt; the row store, display list and window are.
- **Only the viewport window is in the DOM.** `calcVisibleRange` over `displayRows` plus the small
  overscan drives `renderWindow`; top/bottom spacers carry the rest of `calcTotalHeight`. Do not
  "hide" offscreen rows — they were never built.
- **Rows are data, then text nodes.** The host emits `EcucRow` values; the page builds labels and
  values with `textContent`. Never use `innerHTML` for model text, and never reuse a full-tree HTML
  string as the re-scan payload.
- **Selection never recolours syntax.** A selected parameter uses `--sel-bg-focus`, the 2px
  `--rail` and a 1px `--sel-outline`; a selected container/module uses the visible neutral
  `--sel-container-bg` with the same rail/outline, and its visible subtree gets the softer
  `--subtree-bg` tint. Tokens keep their colours; high contrast uses outlines, not fills. Do not
  reintroduce `--ecuc-selection-fg` or a monochrome selected line.
- **`.value` stays a direct child of `.row`.** `valueSpan` and tests select `.row > .value`; a wrapper
  cell breaks them. The value contains a `--tok-punct` `=` and a `.value-text`; the document never
  inserts an input. The details input is a separate `.details-value` in the inspector.
- **One Document presentation.** There is no Tree toggle, view state, Tree grid/glyph/chip CSS or
  Tree row height. Do not reintroduce a hidden second view.
- **The Document surface is text first.** Structural labels are neutral; only `--tok-*` keywords,
  strings, numbers, meta, comments, the green container name, the yellow italic reference target and
  the single key accent carry colour. Reference targets are plain text, not links; values have no
  dotted underline or hover pencil. Empty containers show a muted `{ }` marker so they are distinct
  from parameters. Use `--fold-gutter`/`--content-pad`/`--doc-pad`/`--indent`; there is no line-number
  gutter. The `=` is punctuation, not part of the value token.
- **A condition tooltip explains inputs, not the result.** The row's dimmed state already says the
  condition is false, so the chip `title` lists `NAME = value`, one per line in source order;
  strings are quoted and missing values read `(not set)`. Do not put `true`/`false` or a
  `unknown (missing: …)` summary back in the title. A parse/type reason may follow the value lines;
  a bare `missing:` reason is suppressed because the lines already show it.
- **Annotations describe the node below them.** They are muted italic `/* … */` comment rows above
  the node, not pills at the end of the line. Multiple annotations stack in source order.
- **No line-number gutter.** Do not add `data-line`, `data-ln-digits`, `--ln-*`, `--gut`, a digits
  payload or source-position fields back to the row model. Bracket guides are the only vertical
  rules; they run from opening to closing brace, fade at rest and activate on hover. A repeating
  indent gradient is forbidden.
- **Defaults are Document and the Details tab.** `editorShell` writes `data-view="document"` and the
  sidebar mounts with Details selected by default; Conditions starts hidden. The tab, sidebar width,
  section panes, collapsed sections and sidebar visibility persist through `getState()/setState()`. A
  legacy `inspectorHidden` is ignored; the sidebar's Details tab owns the panel, there is
  no Details/Conditions toggle and no second panel surface.
- **Details editing is the only field edit path, and structural edits are confirmed.** The panel
  edits a parameter's `<VALUE>` and a container's `<SHORT-NAME>` / `<DEFINITION-REF>` inner text.
  A container or parameter row may also be **deleted or duplicated** from the page context menu; the
  host asks for confirmation (and a unique short name for a container duplicate) before one
  `WorkspaceEdit`. The page never writes. A structural plan re-scans and compares the recorded
  element bytes before applying, so a moved node is a refusal, not a partial edit. Deleting an
  own-line element removes its line and indentation; a duplicate is inserted after the original with
  the document's own line break. One `Ctrl+Z` restores either action. The value control follows the AUTOSAR
  type: integer/float/text use an input with type-specific character checks; Boolean uses a
  true/false select. A parameter commits through `{ type: 'edit', nodeId, value }` (no `field`); a container
  commits the same message with `field: 'shortName' | 'definitionRef'`. The host normalises a
  missing `field` to `value` and ignores an unknown one. Enter commits, Escape restores, Tab moves
  (adjacent parameter for a value, the other container field for a container). A refusal keeps the
  typed text, marks the control invalid and shows the reason beside the field. Recoverable warnings
  never use a banner: condition-name warnings go to the Conditions status; follow failures and field
  refusals that cannot be shown inline go to the Details status. The editor has no notice element;
  page errors are console-only.
  Only
  a container is editable this
  way; a module rename is refused because its short name is part of every container id. The panel
  exposes Jump to target for a followable reference plus Reveal in source; there is no Source block
  or copy action.
- **Types and formats live in details.** `ParameterNode.definitionDest` feeds the details Type row;
  integer values show Decimal/Hexadecimal/Binary (`0x0F`, `0b00001111`). Do not put `(= 0x…)` back
  into the Document meta; the Document shows the value once.
- **Definition data is optional and additive.** `EcucRow.definition` is filled only when the workspace
  index resolves the row's `DEFINITION-REF`; without a lookup no row carries the field. The Details
  projection order is Definition type, Range, Default, Multiplicity, Values, Destination, Definition
  description, Definition file. Do not warn about a missing definition or fall back to a guessed type.
- **The workspace index is memory-only.** `IndexService` rebuilds it on activation and owns the
  `**/*.arxml` watcher; the core `WorkspaceIndex` has no file or `vscode` access. A file is read through
  a stream, upserted as one `FileIndex`, and never copied into another file's entry. The status bar is
  hidden at zero files when the window has a workspace folder; a folder that exists but has no indexed
  `.arxml` still shows the mode so `cross-file checks off (no project)` is visible. Do not show
  `0 files indexed`.
- **Dark is the supported theme for now.** Do not re-add a light-only selection/token branch or a
  light preview/capture; high contrast is the accessibility variant. High-contrast/forced-colors
  subtree rows use a dotted outline, not the fill.
- **The fold gutter is fixed.** The 26px gutter and 16px chevron are the VS Code geometry; do not
  put the twisty back into the label flow. Expanded chevrons are hover/focus-only and collapsed
  chevrons stay visible. The twisty hit area spans the row height.
- **Reference follow is index-backed and details-only.** A reference is followable when the same-file
  `resolvePath(model.pathIndex)` or the workspace `resolveTarget` accepts its target and `DEST`; the
  details panel shows Jump to target and posts the existing follow message. A refused cross-file target
  is not followable and carries a `Target note` reason; the Document value is plain text (no
  `data-follow`/link). A same-file target selects the row; an ECUC-Values target opens that file in the
  custom editor; any other target opens the text editor.
- **Text-editor features reuse the same index.** Document symbols, definition, references, links and
  hover are registered once for `.arxml` and return nothing when `arxmlScope.index.enabled` is false or
  the document matches `arxmlScope.index.exclude`. The text editor uses the live document text, not the
  indexed disk bytes.
- **Copies of one path resolve together, never by guessing.** `WorkspaceIndex` keeps every candidate.
  Candidates that share kind and `DEFINITION-REF` are copies: resolution prefers the copy in the
  referencing file, otherwise returns all copies sorted; multiple local copies with one identity are
  all returned with the earliest local copy first. Differing identities stay ambiguous.
  `definitionCandidateCount` is how the UI says `N definitions found` without choosing one.
- **Split copies and variants are not duplicates.** `duplicateShortName` suppresses cross-file
  same-identity copies whose normalized content hashes differ (AUTOSAR split files) and copies whose
  distinct non-empty `SW-SYSCOND` guards make them alternatives. Byte-identical copies, same-file
  groups and differing identities stay reported. `multiplicity` counts the lower bound against the
  total but the upper bound per guard, with an unguarded occurrence counted in every guarded bucket.
  `missingRequired` skips a child whose definition carries `withAuto === true`.
- **Cross-file rules have one mode owner.** `arxmlScope.validation.crossFileRules` is `auto` by
  default; `auto` runs a rule only when the index has at least one definition, `always` reproduces the
  unconditional behaviour and `never` disables it. A fragment workspace (values without definitions)
  stays quiet. The status bar shows the effective mode and the cycle command is the only writer.
- **Validation output is capped at the host seam.** Per-file and workspace caps (`0` = unlimited) drop
  diagnostics before they reach the collection and add one `diagnosticCap` summary per file. Caps are
  settings read in `validationService`, not options baked into the pure engine.
- **Diff panes keep the live document state.** The inner diff node keeps `aria-expanded` so the shared
  document CSS draws the chevron and the collapsed `{ ... }` marker in both panes. Selection uses the
  shared document-tree rule; do not add a diff-only selected-cell rule.
- **Semantic diff is opt-in in core, on in the host.** `DiffOptions.semanticMatching` defaults off so
  core output is stable; the host reads `arxmlScope.diff.semanticMatching` (default on) and the toolbar
  posts `matchMode` for the current panel only. Strict must reproduce the pre-semantic output exactly.
- **A match-mode toggle never re-scans.** The host keeps both engine handles from the last refresh and
  asks `diff.compute` for the other mode; the engine re-pairs without a re-scan, and a stale
  `TextDocument.version` falls back to a full refresh. The page flips `aria-pressed` and the label
  immediately and shows `aria-busy` while the engine answers. `DiffSession` survives only as the
  TypeScript parity oracle under `src/test`; do not route production through it. Do not call
  `refreshNow()` from the match-mode handler unless the prepared version is stale.
- **The diff toolbar has no count summary.** The left order is Show all / Show diff, divider,
  Context, divider, Semantic / Strict, divider, Prev/Next; Swap is centered over the pane divider;
  status and Search are on the right. Context is the only standalone toggle, default active at five
  lines and disabled in Show all. Every main button uses an inline icon over a small label.
- **One virtual scroll owns the document.** `VirtualScroll` owns the vertical bar, the per-pane
  horizontal bars and the precomputed offsets; `DocumentTreeView` renders only the visible window.
  Header rows are ordinary content rows and must not be pinned again. The diff keeps the file-name
  strip outside the scroll surface; one shared offsets table drives both panes, and the pane split
  stays fixed horizontally.
- **Diff-only gaps are expandable split lines.** `diffVisibility(rows, true, 5)` keeps five context
  rows; `flattenDiffDocument` turns the remaining hidden runs into `DiffGap` rows. A gap row is not a
  tree node: it must stay out of `displayIndexByKey`, `navigationVisible`, `F7` and search. The
  displayed left pane owns the toggle; the right pane draws the line only.
- **Collapse controls stay findable.** The toolbar Collapse/Expand controls keep their labels above
  1040px, matching the diff toolbar; labels hide only at <=1040px and the `aria-label` remains. The
  fixed gutter keeps the row control at the far left instead of indenting it with the label.
- **A re-scan keeps state, not markup.** The host posts `{ type: 'document', document: { rows, selectedId, header } }`; the
  page reconciles selection, collapse, search and scroll, rebuilds the display list and renders the
  window. There is no `innerHTML` tree swap and no second refresh path.
- **Search runs on Enter through the chunked engine, never a synchronous full scan.** Typing only
  updates the field and the clear X; a changed query cancels the old run until Enter. `RowSearchEngine`
  scans 512 rows between clock checks with a 24 ms budget, a 120 ms debounce, a 150 ms progress
  throttle and a generation token. The haystack is the label, value, every visible meta fragment and
  the schema/package header rows, so annotation, variant, condition, context and header text is
  searchable. The first streamed match is
  jumped to; completion preserves the current row by id; later navigation only moves an index. Only
  rendered rows get `<mark>` elements. All matches use the fixed `--match-bg` tier; the current
  match's row adds `data-search-current` for `--match-hi`. Do not restore a synchronous `searchRows`
  page scan or theme find-match variables that can be transparent.
- **Conditions row actions are icon-only.** Edit, Save and Cancel use the shared `.act-btn` primitive
  with pencil/check/X SVGs, `title` and `aria-label`; Remove is the trash icon. Save/Cancel are
  visible only while editing. Do not restore text Save/Cancel buttons.
- **The Details tab is one section.** `updateInspector` rewrites only `#sb-details-body`; Node, value,
  reference, condition and annotation fields plus Jump/Reveal share that scrolling body. Do not split
  them back into panes or add sashes to Details.
- **Benchmarks are committed and CI-run.** `npm run benchmark` discovers
  `src/test/benchmarks/*Benchmark.ts`; the CT `Benchmarks` job and its summary read the JSON `_type`
  lines. A benchmark must stay headless (no `vscode`, no DOM) and synthetic. A benchmark is evidence,
  not a performance promise: set hard limits well above observed shared-runner variance, because a
  limit within that variance is a flaky gate rather than a regression guard.
- **Packaging is verified from the VSIX, not the ignore file.** Before calling a config change done,
  run `npx @vscode/vsce ls` and confirm the listing matches the intended package: runtime `dist/`
  files, manifest, README/CHANGELOG/LICENSE, icons and the user `docs/`/`examples/`; no `src/`, `out/`,
  tests, build configs or caches. `.vscodeignore` gotchas: `.*/**`
  does not exclude a dot-named directory that is a junction, so use `**/.vscode-test*`; root dot-files
  such as `.gitattributes` need their own line. Every kept line must name an existing path or
  generated output — never copy another repository's ignore list wholesale.

## Before calling work done

- `npm run check-types`, `npm run lint` and `npm test` are green.
- `npm run package` is green and `npx @vscode/vsce ls` lists only the intended package files
  (runtime, docs, manifest, icons).
- Every new assertion fails when its feature is deleted (`testing.md`).
- Anything that could not be verified in this environment is stated plainly as unverified — not
  implied to have passed.
