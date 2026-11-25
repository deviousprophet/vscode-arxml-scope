# Webview Preview Audit Code-Spec

The `webview-preview` harness is the rendered-layout proof for the webview. It serves the
**production** shell and bundled page entries, drives them through the real host
protocol, captures each seeded state in headless Chromium and writes a geometry/paint
audit. A screenshot can look plausible while the geometry is wrong — a toolbar control
under the Search field, a gutter item offering both directions on a deletion — and the
jsdom suites cannot see layout at all.

Executable workflow, flags, outputs and cleanup: [`SKILL.md`](../../../.agents/skills/webview-preview/SKILL.md).
Human state table and limits: [`docs/contributor/WEBVIEW_PREVIEW.md`](../../../docs/contributor/WEBVIEW_PREVIEW.md).
Pinned Monaco surface: [`diff-parity.md`](./diff-parity.md).

## Trigger

Run the captures after any change to the toolbar, the rows, the diff strip, the gutter,
folding, the page shell or a seeded fixture. Use the narrowest state for a fix loop; run
the **full seeded set** for a layout change before asking for review.

## Execution rules

1. `--list`, then capture the narrowest state that exercises the change (`--state <name>`).
2. Read `<state>.audit.json` **first**. A non-empty `violations` array blocks review; fix
   those before looking at the image.
3. Inspect `<state>.png` for colour, spacing and clipping the invariants do not encode.
4. Recapture the same state after a fix.
5. For layout changes, capture the full set (every `STATES` entry).
6. Record the observation with the state name and what changed in the task notes.

The runner must fail the process on a violation. A capture that only prints a warning is
not evidence.

## Architecture contracts

- The harness wraps the production shell (`webviewShell.ts`) and mounts the production
  entries (`diffMonaco.ts`, `editorMonaco.ts`). A second renderer, forked markup or a
  copied page would be a test that agrees with itself.
- `previewData.ts` owns `STATES` (the executable state list), calls the production
  `diffShell`/`editorShell`, injects the supported dark-theme token block and seeds a
  synthetic `DiffDocument` or editor document. The theme block is required: without
  VS Code's variables the gutter is transparent and the rail can be mistaken for a stray
  edge.
- `previewPage.ts` imports the production entries. They auto-mount when their root is
  present, exactly as in the extension. **Never call a mount function again**: a second
  mount binds every toolbar action twice, and toggles such as Merge and Swap cancel
  themselves out.
- `previewAudit.ts` reads the rendered DOM: pane/row widths, horizontal offsets, toolbar
  rects and pairwise intersections, the Swap-to-divider distance, the selected row, Swap
  before/after titles and values, page overflow, the 35px built-in `.gutter`, per-hunk
  `.gutterItem` availability and labels, the clicked host copy, the `.monaco-sash`, the
  folding visible-range round trip and per-side model line counts/paint.
- `shotWebview.mjs` starts the server, spawns the browser asynchronously once per state
  (`spawnSync`/`execFileSync` block the event loop and the server cannot answer Chrome),
  requests `--dump-dom` and `--screenshot` in one run, extracts the audit from the DOM,
  writes `<state>.audit.json` and fails on violations.
- `previewWebview.mjs` bundles the skill's `previewData.ts` for Node and
  `previewPage.ts` for the browser with esbuild and serves one HTML document per state.
  It serves the bundled `monaco.worker.js` and hashed font assets and deliberately drops
  the production CSP for the local surface.

## Audit invariants

Every item is a **must**. The state in parentheses is the seeded proof; the audit reads
the listed DOM/model state, not a screenshot diff.

- **Toolbar never overlaps.** No overlapping controls, no control outside the viewport,
  no control clipped by its group, and the Swap action within 12px of the pane divider at
  1400/1200/1024/900/800/640 (`toolbar-*`). Secondary labels drop first, then primary
  labels; the find widget is not a toolbar slot and opens only on `Ctrl+F`.
- **Merge is a toolbar action.** `#diff-merge` is in the strip and visibly pressed
  (`aria-pressed="true"`) in `diff-merge`.
- **Find is the native widget.** `editor-find`/`diff-find` show Monaco's `find-widget` with
  the `Aa`/`ab|`/`.*` toggles, the native count (`1 of N`) and no custom search strip. The
  editor/tree/diff hosts must allow the tooltip to paint over the toolbar while the widget
  is open.
- **Diff fills stay translucent.** Changed rows keep readable text; opaque line or word
  fills in the dark preview are a violation.
- **The per-side body has no placeholders.** `diff-one-sided`/`diff-removed` read two
  independently shaped models: no `arxml-diff-placeholder` decoration or element, a native
  `.diagonal-fill` for the missing side, the owning side's inserted/deleted fill intact, a
  deletion hunk in `diff-removed`, and unequal model line counts there. The `oneSided`
  object records models, changes, gutter availability and native paint.
- **Folding works in both panes.** `diff-merge` starts with the full visible row count,
  Collapse All hides rows and Expand All restores the count (`visibleBefore`,
  `visibleCollapsed`, `visibleExpanded`, chevron count). Chevrons are hover-controlled, so
  the pass condition is the visible-row round trip.
- **Value kinds keep their colours.** `editor-syntax`: `0b1010` uses the same colour as
  decimal `42`, `P.Syn.Syntax.Target` uses the reference colour, and
  `CANIPCORETYPE_SC==0` keeps distinct name/operator/number colours.
- **The condition palette is shared.** `editor-syscond`: the Monaco condition line and the
  Details `Condition` code share the macro-blue name, magenta operator, cyan literal and
  unchanged numbers; the Conditions panel constant name/state use the same colours and the
  state keeps its dashed border. A token falling back to the foreground or a panel colour
  drifting from the shared tokens is a violation.
- **A short name is never a definition label.** `editor-labels`: the no-label container
  line reads `"EmptyDef" { }` with the quoted short name in the string colour; the normal
  container reads `Items "Items"` with the label in the type colour and the short name in
  the string colour. A no-label first token that is not the string colour, a swapped
  label/short-name pair, or an unselected no-label container is a violation.
- **Dirty typing is visible and coalesced.** `editor-dirty` shows `● Unsaved changes`
  after a multi-character typing run and posts no host edit before `Ctrl+S`. The audit
  fails when the status is hidden or empty.
- **Invalid input blocks save.** `editor-invalid` shows the page error, posts no edit and
  no save after the `Ctrl+S` attempt.
- **Details typing stays local and keeps the caret.** `editor-details` shows the redrawn
  editor line, focus and the caret at the end of `#details-value`, and posts no host edit;
  `editor-details-save` sends one raw edit on `Ctrl+S`, posts the save only after the ack,
  and keeps focus/caret after the host echo rebuilds Details.
- **A rename holds the draft across an early ack.** `editor-details-rename` acknowledges
  the short-name edit before its re-scan, defers the second `Ctrl+S`, then submits the
  post-flush `Syntax23` at the predicted id; focus/caret stay and no stale-node notice
  appears.
- **A refusal after the renamed re-scan lands at the new id.** `editor-rename-refusal`
  shows the post-flush `Syntax23` addressed at the host's new id, the inline reason beside
  the short-name field, the refusal in the Details status, focus on that control, and no
  save after the refusal.
- **A late acknowledgement keeps the caret.** `editor-rename-late-ack` delivers the
  renamed re-scan first and the host pair second; the post-flush `Syntax23` still moves to
  the new id, the short-name field keeps focus/caret, and the save follows that edit's ack.
- **Undo returns to the host value.** `editor-details-undo` undoes the local Details
  draft, restores `hello`, clamps the caret, hides the dirty marker and posts no host edit.
- **Redo restores the undone draft.** `editor-details-redo` restores `hello updated`, the
  caret and the dirty marker and posts no host edit.
- **Delete paths stay local.** `editor-delete` types, backspaces, deletes by word, replaces
  a selection, clears and retypes the textual value; it ends at `Text = "R"`, keeps one
  quote pair, shows the dirty marker and posts no host edit.
- **Two rows save on one Ctrl+S.** `editor-multi-save` edits `Decimal` and `Text` locally,
  then `Ctrl+S` posts two `edit` messages in values-first order, one `save` after both acks,
  and shows `Decimal = 427` and `Text = "hello!"` after the host echo.
- **A pasted newline stays one line.** `editor-paste` pastes `\nsecond` into `Text`; the
  line reads `Text = "hello\nsecond"` with the newline escaped, one quote pair, and no host
  edit.
- **A stale draft blocks the save.** `editor-stale-save` types into `Text`, receives a
  re-scan without that row, and attempts `Ctrl+S`; no edit and no save are posted and the
  Details status says the node is no longer in the file.
- **Sticky scroll keeps the scope.** `editor-sticky` keeps the enclosing `Items` header
  pinned while the viewport is deep in its parameter list.
- **The diff sticky header shows the full parent scope.** `diff-sticky` scrolls deep into
  the shared `Items` container. The audit requires a visible `.sticky-widget` whose text
  contains `Items "Items"` and the module header; `{`-only, empty or hidden sticky text is
  a violation. The diff documents end with the same trailing newline as the editor so the
  outermost folding scope stays valid.
- **The built-in gutter mounts and gates on Merge.** `diff-merge` has a 35px `.gutter`,
  hunk `.gutterItem`s and the Copy Block to Left/Right labels; `diff-off` hides only the
  items and keeps the gutter and sash. A third action, `Revert Block`, or any copy while
  Merge is off is a violation.
- **The Merge arrows are centered on their hunks before any scroll.** The alignment probe runs
  immediately after the Merge message, before folding or sash gestures. It compares each compact
  visible `.gutterItem` with its `.buttons` toolbar and fails when their centers differ by more
  than 1px. This pins the hidden-layout bug where `display: none` made Monaco measure a 0px
  toolbar and draw the arrows almost one line low until the next scroll.
- **One-sided hunks offer both directions.** `diff-removed` and `diff-added` render both
  `Copy Block to Left` and `Copy Block to Right` on the one-sided hunk. Copying from the
  owning side adds the block; copying from the empty side posts the owning row key with the
  empty side as the source, which the host turns into a delete. The audit checks the
  rendered labels and the posted side/key. Changed pairs expose both actions too.
- **Swap keeps the displayed-pane meaning.** In `diff-swap` the first action posts the
  stored side now shown in the source pane (`side: "left"` after the swap). The audit
  derives the expected side from the clicked action and the swap flag.
- **The built-in sash resizes and resets.** `diff-sash`, `diff-off` and `diff-swap` start
  at 50/50 (left pane plus the 35px gutter equals the right pane), drag wider, keep the
  ratio after a document replacement and (for `diff-swap`) Swap, and double-click returns
  to 50/50. The audit records every width pair.
- **Swap mirrors the panes.** The audit snapshots the titles and the first changed values
  before the click and requires each side to take the other's after it.
- **Next diff scrolls.** `diff-rail` starts above line 1000 and lands on the first changed
  row; the selection and the rail agree.
- **Prev/Next visit every change once and wrap.** `diff-nav` records the modified-editor line
  after each Next, each Prev and each Next after Swap. The audit requires each sequence to be a
  cyclic rotation of the change lines with one wrap step, so a repeated current change or a
  skipped change is a violation.
- **A collapsed container keeps its node header and folds both panes.** `diff-collapsed` folds
  the `Items` container through the folding command from each side in turn. The audit requires
  the full `Items "Items"` line and `⋯` fold hint in both panes and no visible `P0000` child
  row; a one-pane fold, a `{`-only line or an unfolded container is a violation.
- **Editor page.** Toolbar, line-number gutter, selected row and Details panel render
  without clipping. The `select` state must leave a selected row in the audit.

## What the audit does not prove

The audit proves geometry and paint in Chromium at the listed sizes. It does not prove VS
Code theme fidelity (tokens are seeded), real keyboard/IME input, screen-reader output,
OS clipboard behaviour, packaged VSIX behaviour or performance; those need the Extension
Development Host and a task-note manual check. The condition palette is fixed per theme
class, so the capture proves the dark palette; light and high-contrast values are asserted
by the stylesheet tests. The paste probe dispatches a clipboard-shaped event to the
editor's capture guard; it does not exercise the OS clipboard or Monaco's own paste
handler. The overview ruler marks the change region; the missing side relies on Monaco's
diagonal view zone, which is not a model line and carries no added/removed tint.

## Must not

- **Must not** add a second preview source under `src/test` or `scripts/`.
- **Must not** reintroduce `preview:webview` / `shots:webview` package aliases; invoke the
  skill scripts directly.
- **Must not** accept a capture without reading the audit JSON.
- **Must not** treat a single-state capture as the full-set gate for a layout change.
- **Must not** replace the production shell or page entries with preview-only markup.
