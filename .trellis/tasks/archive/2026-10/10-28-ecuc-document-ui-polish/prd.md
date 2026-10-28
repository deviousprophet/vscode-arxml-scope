# ECUC Document-only UI polish and details editing

## Goal

Make the ECUC editor a single, quiet **Document** presentation rather than a two-view viewer. The
Tree view adds little over the Document view, the source-line gutter is misleading under the sorted
row order, and inline value editing on the document surface exposes the `=` punctuation as part of
the click target. This task removes the Tree view and the line-number gutter, replaces the full-width
indent rules with bracket-connected guides, moves parameter editing into the details panel, and
sharpens the surface: larger labelled collapse controls, green containers, yellow-italic same-file
reference links, a dark-only palette, and a clear selection hierarchy. It also removes the `F2`
hover/selection hint, the details Source block, and the Copy path/Copy value actions.

The virtual row window, collapse/filter engine, selection/focus/reveal/re-scan behavior, quiet-source
tokens, braces, metadata and `.value` direct-child contract stay. `src/core/**`, the write path, the
manifest and dependencies do not change.

## Scope

**In**

- Remove the Tree view completely: toolbar toggle, saved `view` state, Tree CSS/grid/row heights,
  per-kind glyphs/chips/dotted-value presentation, and Tree-only tests/docs/captures.
- Remove real source line numbers from the Document gutter, the `data-line`/`data-ln-digits` output,
  the `digits` row payload, and the row source-position fields used only by that gutter and the
  details Source block. Re-align the document text, braces and header at the new left edge.
- Remove the continuous indent-guide background. Draw one guide per open container from its opening
  brace to its closing brace, faded at rest and clearer on container hover, recomputed on
  collapse/filter/scroll.
- Refine the surface: larger labelled Collapse/Expand controls, a visible row twisty, green container
  names, yellow-italic reference targets, dark-only styling, same-file follow to the target container
  in the editor, and a subtree/active selection hierarchy.
- Keep the main Document read-only for values: clicking a value selects the row and opens/focuses
  the details value editor; clicking `=` or the label only selects. Remove the inline `.value` input.
- Add a details-panel value input for parameters: click the value, press `F2` or `Enter` to open and
  focus it; `Enter` commits, `Escape` cancels, `Tab`/`Shift+Tab` commits and moves to the adjacent
  parameter. A refused write keeps the typed text, marks the input invalid and shows the reason.
- Remove the `F2` decorative hint on the selected parameter line; keep the keyboard shortcut.
- Remove the details Source block (the Reveal in source action remains).
- Remove Copy path, Copy value and Copy target from the details actions and the host clipboard/copy
  message path; keep Reveal in source.
- Preserve filter, collapse/expand, selection, focus/roving tabindex, reveal/follow, re-scan, empty
  state, details toggle, saved details visibility and the virtual window.
- Tests, browser captures, performance observations, mutation checks, docs and frontend specs.

**Out**

- Changes to `src/core/**`, the parser/model/ordering/validation, the write path, the manifest or
  `package.json` dependencies.
- A second renderer, new dependency, asset, Worker, service worker, remote load or CSP relaxation.
- Structural editing, retargeting references, cross-file references, soft wrap or a new visual theme.
- Keeping a hidden Tree mode behind a setting; the view and its state are removed, not hidden.
- A new details-panel layout unrelated to the value input; the existing panel sections stay except
  Source and the copy actions.

## Requirements

- **R1 - Document only.** There is no view toggle, no `view` state, no Tree row heights/probes, no
  Tree grid/chips/glyphs and no Tree-specific CSS or tests. The page renders one Document tree; the
  flat `role="tree"` semantics, collapse/expand, filter, selection, focus, reveal/follow and re-scan
  remain.
- **R2 - No source-line gutter.** The page shows no line numbers, no `data-line`/`data-ln-digits`,
  no `digits` payload and no source-position fields solely for display. The header, text, braces,
  fold column and indentation align at a stable left edge; the document remains horizontally
  scrollable with `white-space: pre`.
- **R3 - Bracket guides.** No continuous full-page indent rules. Each container draws a vertical guide
  from its opening brace to its closing brace, with one segment per nesting level. Guides are faded
  at rest and become clearer while the pointer is over the container. They are structural, not tied
  to selection, and update with collapse/filter/scroll.
- **R4 - Read-only Document values.** Parameter values, `=` and labels are read-only on the document
  surface. `.value` remains a direct child of `.row`; no input is inserted into `.value`. Clicking a
  parameter value selects the row, opens the details panel and focuses its value input. Clicking the
  `=`/label selects without entering edit. Reference values remain follow targets.
- **R5 - Details editing.** A selected parameter's details panel shows an editable value input.
  `F2` or `Enter` on the focused row opens/focuses it; clicking the value does the same. `Enter`
  commits through the existing write path, `Escape` restores the current value, and
  `Tab`/`Shift+Tab` commits then moves to the adjacent parameter. A refusal preserves the typed
  text, marks the input invalid and shows the reason; a success re-scans and updates the panel.
- **R6 - Remove the F2 hint.** No `F2` pseudo-element, text or hover hint appears on the document.
  `F2` remains a keyboard shortcut for the details editor.
- **R7 - Details cleanup.** The details panel no longer shows a Source block, Copy path, Copy value
  or Copy target. Reveal in source remains. Kind, label, definition, short name, variant, value/hex,
  target, context, conditions and annotations stay as applicable.
- **R8 - Contracts.** One renderer, one Document presentation, no `.artext`/`mmx`, no new dependency/
  asset/worker, CSP nonce, no `innerHTML` from model text, `src/core/**`/write path/manifest
  unchanged.
- **R9 - Verification.** Pure row/filter/virtual tests, Document-only page tests, details-editor
  tests, browser captures for the Document states, performance observations, mutation checks and the
  full gates. `docs/ECUC_EDITOR.md`, the frontend specs and `docs/ECUC_EDITOR_DESIGN_SPEC.md` must
  describe the new UI rather than the removed Tree/line-number/F2/copy design.
- **R10 - Clear collapse controls.** The toolbar Collapse/Expand controls are larger and labelled
  (labels may hide at narrow widths), and the row twisty is visible at rest with a larger hit area;
  collapse/expand still does not move selection.
- **R11 - Dark semantic accents.** Container names are green like a C typedef/type; reference
  targets are yellow and italic. Colors stay `--vscode-*` variables with dark fallbacks. The dark
  theme is the only supported presentation in this pass; high contrast remains the accessibility
  variant, and no light-theme pass is maintained.
- **R12 - Same-file follow.** A reference target is a follow link only when it resolves in the same
  file. Following selects/jumps to the target container in the ECUC editor (not the text editor);
  an absent/ambiguous target is not a link and produces no follow action.
- **R13 - Selection hierarchy.** Selecting a container or module highlights its visible parameters
  and sub-containers as a subtree; selecting a parameter uses a stronger active fill, rail and thin
  outline so the selected row is unmistakable. Selection never recolours syntax.

## Acceptance Criteria

- [x] **AC1** The Tree toggle, view state, Tree row heights/CSS/glyphs/chips and Tree-only tests/
      captures are gone; the Document view still collapses, filters, selects, reveals and re-scans.
- [x] **AC2** No line numbers, `data-line`, `data-ln-digits`, `digits` payload or display-only source
      position fields remain; the header, text, braces and fold column align cleanly at the new left
      edge in dark/HC/narrow captures.
- [x] **AC3** No continuous indent guides remain; every container's guide runs from its opening to
      closing brace (nested levels included), is faded at rest and clearer on hover, and updates with
      collapse/filter/scroll.
- [x] **AC4** The Document value/`=`/label are read-only; `.value` stays a direct `.row` child;
      clicking a parameter value selects and opens the details editor, while `=`/label only select.
- [x] **AC5** Details editing works: click value/`F2`/`Enter` focus the input; `Enter` commits;
      `Escape` cancels; `Tab`/`Shift+Tab` commit and move; a refusal preserves text and shows an
      error; a success re-scans, updates the panel and flashes the row.
- [x] **AC6** No `F2` hint is rendered; `F2` still opens the details editor. The Source block and
      Copy path/value/target actions are gone; Reveal in source remains.
- [x] **AC7** The quiet-source look is preserved otherwise (tokens, braces, metadata, selection tint/
      rail, details panel, empty/filtered states, narrow layout) with dark and high-contrast captures.
- [x] **AC8** `npm run check-types`, `npm run lint`, `npm test`, `npm run preview:check` are green;
      focused tests and mutation checks pass; large/huge load and filter observations are recorded.
- [x] **AC9** `docs/ECUC_EDITOR.md`, the frontend specs and the design spec describe the Document-only
      UI, no-line-number geometry, bracket guides, dark accents, same-file follow, selection
      hierarchy, details editing and removed actions; `src/core/**`, dependencies, manifest and
      write path are untouched.
- [x] **AC10** The Collapse/Expand controls are visibly larger and labelled; the row twisty is
      visible at rest; both still preserve selection.
- [x] **AC11** Container names are green, reference targets yellow italic; dark is the only supported
      theme, with high contrast retained and light-theme styling absent.
- [x] **AC12** A reference target is a follow link only for a same-file target; following jumps to
      the target container in the ECUC editor; absent/ambiguous targets are not links.
- [x] **AC13** Selecting a container/module tints its visible subtree; selecting a parameter uses the
      stronger active fill/rail/outline; syntax colours are unchanged.

## Constraints

- Keep the existing nonce CSP and inline script/style model; no style attributes for depth, guides or
  spacer heights.
- No full-tree DOM: only the viewport plus overscan is rendered.
- Row text is inserted with DOM APIs (`textContent`/text nodes), never model `innerHTML`; the initial
  row JSON stays escaped.
- Keep the existing write path and provider validation; the details input posts the same
  `{ type: 'edit', nodeId, value }` message.
- The document is read-only for values; there is no second inline editing path.
- Bracket guides are visual only; they must not change selection, collapse or filter state.
- The performance evidence is harness evidence, not a real VS Code webview claim.
