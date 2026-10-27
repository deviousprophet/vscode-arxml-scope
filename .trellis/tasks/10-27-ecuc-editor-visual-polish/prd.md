# ECUC editor visual preview and UI polish

## Goal

Make the ECUC editor's rendering **visible while developing** and use that loop to improve how ARXML
data reads. Today the webview is only asserted as an HTML string; nobody can see it without launching
an Extension Development Host. This task adds a local, interactive preview harness that renders the
real page in a browser with a stubbed VS Code host, then uses it to add the details that make the tree
usable for reading: a selected-node inspector, aligned rows, source locations, copy/reveal actions,
filter feedback and an explicit empty state.

Parent requirement IDs (R1–R18) and decisions live in `../10-14-ecuc-artext-editor/prd.md` and
`../10-14-ecuc-artext-editor/design.md`. The interaction/collapse/accessibility work this builds on is
`../10-14-ecuc-editor-ux/`; its seven manual rows are the verification gap this task closes.

## Prerequisites

- `../10-14-ecuc-editor-ux` implemented and checked (collapse, state preservation, node ids, filter
  feedback, keyboard map, reveal modes). Its `implement.md` records 7/7 manual rows unverified.
- The value widget's click/key contract is unchanged: its listeners are registered first and claim
  their events with `stopImmediatePropagation` (`src/editor/ecucValueEditor.ts`).
- No gate on a spike.

## Scope

**In**

- A dev-only preview harness: `npm run preview:ecuc` serves the real `renderHtml` output over
  `127.0.0.1`, with a stubbed `acquireVsCodeApi`, fixture switching, theme switching, a simulated
  re-scan, notice simulation and a message log. A `--check` mode validates the page and server without
  a browser.
- Screenshot-driven visual verification in the in-app browser: before/after captures for at least two
  fixtures in light, dark and high-contrast themes.
- A selected-node **details inspector**: kind, full `DEFINITION-REF`, short name/variant, value and
  hexadecimal form, reference target/context, conditions, annotations, and source line/column range.
  Actions: Reveal in source, Copy path, Copy value.
- Row hierarchy and legibility: a two-line grid (label/value on the first line, metadata on the
  second), aligned value column, kind markers/accents, indent guides, hover/selection/focus states,
  ellipsis plus tooltip for long text.
- Toolbar and filter feedback: filter clear button, count badge, expand/collapse controls, a details
  toggle, and a no-match empty state with a clear action.
- Theme robustness: font fallbacks and `--vscode-*` colour variables with usable fallbacks in light,
  dark and high-contrast themes.
- A local synthetic sample set in `../sample` (default `D:\workspace\sample`) with a large file, and
  a scanner/renderer benchmark for it.
- Semantic element colours: distinct kind accents and value-type colours, with reference links and
  short-name identity, all from theme variables.
- Documentation of the inspector and the preview harness in `docs/ECUC_EDITOR.md`.

**Out**

- Changes to parsing, ordering, validation, the write path or `src/core/**`.
- A real webview DOM in the test host. The browser harness is evidence, not a substitute for a VS
  Code Extension Development Host; the difference is recorded, never blurred.
- New runtime dependencies, asset files, remote loads or a build step for the harness.
- Structural editing, cross-file resolution, virtualisation or a workspace index.
- A settings-level redesign of what each entity shows. The parent §6 display rules still hold; the
  inspector and the second row add presentation, they do not remove information.

## Requirements

- **R-VP1 — The preview runs the real page.** `npm run preview:ecuc` starts a local server that
  reads a fixture, scans it with the production scanner, calls the production `renderHtml`, and wraps
  only that output with a stub host, a theme and a preview panel. No second renderer, no copied
  markup.
- **R-VP2 — The preview is interactive.** Fixture, theme and sort can be switched; a button
  simulates a host `model` re-scan and another simulates a value-changing re-scan; info/warn notices
  can be injected; every webview→host message (`select`, `reveal`, `follow`, `edit`, `copy`) is
  visible in a log.
- **R-VP3 — The preview is dev-only and safe.** It binds to `127.0.0.1`, serves only files under the
  committed fixture directories, adds no runtime dependency and does not enter the extension bundle.
  `--check` exercises every fixture × theme and the server itself.
- **R-VP4 — The selected node has a details inspector.** Selecting a row fills a persistent panel with
  the fields listed in Scope; the source range is shown as 1-based `Lline:column` values derived from
  the document text, not guessed from the rendered order.
- **R-VP5 — The inspector acts on the selection.** Reveal posts the existing `reveal` message for the
  selected node. Copy path and Copy value (or Copy target for a reference) post a new
  `{ type: 'copy', text }` message; the host writes exactly that text to the clipboard through
  `vscode.env.clipboard.writeText` and posts a notice. Copying never writes to the file.
- **R-VP6 — Rows read as a hierarchy.** A two-line CSS grid keeps the label and value aligned on the
  first line and puts short name, variant, hexadecimal form, context, conditions and annotations on a
  second, quieter line. Kind markers and accents remain; indent guides stay visible; long labels,
  values and metadata ellipsize with a tooltip rather than causing horizontal scrolling.
- **R-VP7 — Filter feedback is explicit.** The filter has a clear button; the count is a badge that
  says `shown of total`, `No matches`, or nothing when unfiltered; a zero-match filter shows a
  centred empty state with a working clear action. Clearing restores the previous collapsed set.
- **R-VP8 — The inspector is optional.** A toolbar toggle shows or hides the details panel and
  reflects its state with `aria-pressed`/`aria-controls`; hiding it gives the tree the full width.
  The toggle and the panel survive a re-render.
- **R-VP9 — Themes are robust.** Every new colour is a `--vscode-*` variable with a non-transparent
  fallback where the theme may not define one; font families and sizes have usable fallbacks. No
  colour literal appears outside a fallback. Light, dark and high-contrast captures are all legible.
- **R-VP10 — The contracts that must not move stay put.** `.value` stays a direct child of `.row`
  (the value widget and the filter select on it), the widget's listeners stay first and keep
  `stopImmediatePropagation`, `matchRanges` stays the single definition of a match, and the no-takeover
  manifest value is untouched.
- **R-VP11 — Honest verification.** Anything the browser harness cannot prove — real VS Code theme
  variable resolution, a real webview's focus/tab behaviour, host clipboard permissions — is recorded
  as observed in the harness or still unverified, never implied to have passed in VS Code.
- **R-VP12 — Documentation.** `docs/ECUC_EDITOR.md` describes the details panel and its actions and
  the preview command, including that it is a development tool with a stubbed host.
- **R-VP13 — Local sample set.** A committed, dependency-free generator writes a synthetic sample set
  to `../sample` (by default `D:\workspace\sample` here): a minimal file, a full display-rules file, a
  references file, a large file (≥4,000 nodes) and a huge stress file (≥10,000 nodes). A README there
  says the files are synthetic and how to regenerate them. The sample files stay outside the
  repository; the generator is committed.
- **R-VP14 — Performance is measured, not guessed.** A committed benchmark reads a sample file, times
  the production scanner, node index, `renderTree` and `renderHtml`, and reports file size, node
  count, median time, a post-run heap-used delta and RSS (neither is a peak; Node has no per-phase
  high-water mark). The harness may list the local sample directory for manual viewing, but
  `preview:check` stays deterministic and excludes it. No optimisation is made unless the measurement
  shows a problem.
- **R-VP15 — Element colours are semantic.** Modules and containers have distinct accents
  (module/namespace variables), parameters use the field accent, references use the reference/link
  colour; numeric, textual and boolean values have distinct `--vscode-symbolIcon-*` colours; short
  names use the variable colour; reference targets are links. Every colour is a theme variable with a
  fallback; selected rows still use the selection foreground; all three themes stay legible.

## Acceptance Criteria

- [ ] **AC1** `npm run preview:ecuc` starts a server on `127.0.0.1` and serves a page whose tree
      region is byte-identical to the production `renderTree` for the chosen fixture (the wrapper is
      additive). `npm run preview:check` validates every fixture × theme and a live HTTP request, and
      exits 0.
- [ ] **AC2** In the browser, switching fixture/theme/sort reloads the real page; **Re-scan** preserves
      the collapsed set, selection and scroll; **Re-scan with value change** updates the rendered value
      without springing the tree open; info/warn notices appear; the log records select, reveal,
      follow, edit and copy messages.
- [ ] **AC3** Captures exist for `render.arxml` and `navigation.arxml` in light, dark and
      high-contrast themes, before and after the UI pass. Each capture is stored under this task's
      `research/visual/` and referenced from `implement.md`; the browser harness limitation is stated.
- [ ] **AC4** Clicking a module, a nested container, a parameter and a reference fills the inspector
      with the correct kind, full `DEFINITION-REF`, short name/variant, value/hex or target/context,
      conditions, annotations and a `Lline:column – Lline:column` range. The range for a known
      fixture node matches the `LineIndex` calculation.
- [ ] **AC5** **Reveal** posts a reveal for the selected node; **Copy path** and **Copy value** (or
      **Copy target** for a reference) post `{ type: 'copy', text }` with the exact text. The host copy
      helper writes that text through the clipboard interface and returns the notice; no file mutation
      occurs.
- [ ] **AC6** Rows render as the two-line grid: labels and values are aligned across sibling rows;
      metadata is on the second line; long text is ellipsized with a `title`; no horizontal scroll at
      the available harness viewport (912×670; the planned 900×700/1400×900 sizes were not available).
      `.value` remains a direct child of `.row`, and the value widget still starts an edit on click/F2.
- [ ] **AC7** The filter clear button empties the box and re-runs the filter; the count badge reports
      `shown of total` and `No matches`; a zero-match filter shows the empty state and its clear action
      restores the tree and the previous collapsed set; matched label/short-name/value text is still
      highlighted.
- [ ] **AC8** The details toggle hides/shows the panel, updates `aria-pressed`, and gives the tree the
      full width when hidden. The panel and toggle state survive a re-scan and a fixture reload.
- [ ] **AC9** In light, dark and high-contrast captures, no text, marker, border or focus ring is
      invisible. Every new colour is a `--vscode-*` variable (literal only as a fallback); `package.json`
      `dependencies` is unchanged; no asset file was added.
- [ ] **AC10** `npm run check-types`, `npm run lint` and `npm test` are green. New assertions fail when
      their feature is deleted (mutation check recorded in `implement.md`), and the existing
      no-takeover, widget-order and single-`matchRanges` tests still pass.
- [ ] **AC11** `docs/ECUC_EDITOR.md` documents the details panel, its actions and the preview command,
      and the UX task's manual-verification table is updated with what the harness observed and what
      still needs a real Extension Development Host.
- [x] **AC12** `npm run samples:ecuc` writes `minimal.arxml`, `display-rules.arxml`,
      `references.arxml`, `large.arxml` (≥4,000 nodes) and `huge.arxml` (≥10,000 nodes) plus
      `README.md` to the sample directory. Every file is synthetic; the generator uses built-ins only;
      the large files are not committed.
- [x] **AC13** `npm run perf:ecuc -- <file>` reports file size, node count, scan/index/render times and
      a memory estimate (post-run heap-used delta and RSS; neither is a peak high-water mark). The
      large and huge samples are measured and the numbers (plus a browser page-load observation) are
      recorded in `implement.md`. `preview:check` remains deterministic and excludes `sample/`.
- [x] **AC14** Parameters carry `data-value-kind="numeric|textual|boolean"`; module/container/
      parameter/reference accents use distinct `--vscode-symbolIcon-*` variables; reference targets use
      a link colour; short names use the variable colour. Light/dark/high-contrast captures show the
      new colours, selected-row contrast is still measured, and no colour literal appears outside a
      fallback.

## Constraints

- The preview harness is plain Node (built-ins only) under `scripts/`; it requires `out/` from
  `npm run compile-tests` and must not be imported by `src/extension.ts`.
- The page's CSP is `default-src 'none'`; the injected stub, theme and panel use the same nonce. No
  inline event-handler attributes.
- `src/core/**` is untouched. The inspector is derived from the model and the document text already
  available to the provider; `LineIndex` is already in `src/core/text/offsets.ts`.
- The copy message is the only new host message; it must not touch the document.
- The webview is a plain inlined page: inline SVG only, no font/image asset, no remote load.
- The sample directory is outside the repository and contains synthetic data only. The generator and
  benchmark are dev-only and are not imported by the extension; `src/core/**` is untouched.
- A benchmark number is not a promise. Real webview layout/paint and real customer files remain
  unverified; the samples are synthetic and the browser harness is not a VS Code webview.
- Any behaviour needing a real webview DOM is recorded as harness-observed or unverified, never
  claimed as a VS Code webview pass.

## Notes

- The preview harness is also the fastest way to check the next UI change: it reloads in place, and
  the in-app browser can click, type, scroll and screenshot it.
- The inspector is deliberately additive. The parent §6 display rules still describe what is shown;
  the second row and the panel make it legible, they do not hide entity data.
- The biggest risk is that the harness diverges from the real page. R-VP1 makes the real
  `renderHtml` output the only source, and AC1 asserts the tree region comes from it.
