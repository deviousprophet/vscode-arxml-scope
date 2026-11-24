# Webview preview and screenshots

A development-only harness that serves the **production** webview shell and the real
bundled pages, seeds each page through the host protocol, and captures every state with
a local headless Chrome or Edge. Every capture also writes a rendered-geometry audit:
the page measures its own panes, arrows, toolbar, gutter and scroll offsets after the
gestures, and the runner fails when an action escapes its pane or overlaps a neighbour.
The audit exists because a screenshot can look plausible while the geometry is wrong —
an arrow can be outside a panned row, or a toolbar control can sit under the Search
field — and the jsdom suites cannot see layout at all.

The harness wraps the production shell (`webviewShell.ts`) and mounts the production
entries (`diffViewer.ts`, `editorViewer.ts`). There is no second renderer, no forked
markup and no extra dependency.

## Commands

```bash
# Serve every state at http://127.0.0.1:4173/?state=diff-off
npm run preview:webview

# Pick a port
npm run preview:webview -- --port 4180

# Capture every state to artifacts/webview/<state>.png and <state>.audit.json
npm run shots:webview

# Capture one state, or list the state names
npm run shots:webview -- --state diff-merge
npm run shots:webview -- --list
```

The capture exits non-zero and prints every violation when the audit fails. Read the
`<state>.audit.json` for the measured boxes, scroll offsets and the full violation list;
the PNG is the visual check, the JSON is the proof of placement.

The browser is detected from the usual Chrome/Edge install locations. Set
`CHROME_PATH` to override it. `artifacts/` is gitignored; screenshots and audits are
evidence for the change under review, not committed fixtures.

The first capture starts a private preview server on a free port. Stop a manually
started `preview:webview` before relying on a fixed port; a stale server keeps serving
its old bundle.

## States

| State | Page | Size | What it exercises |
|---|---|---|---|
| `diff-off` | diff | 1400×900 | baseline diff; no merge arrows |
| `diff-merge` | diff | 1400×900 | Merge pressed; changed rows show the extra copy-left arrow in the built-in diff margin |
| `diff-swap` | diff | 1400×900 | Swap pressed; headers, values and the copy-left source side mirror the displayed panes |
| `diff-rail` | diff | 1400×900 | long document; **Next diff** jumps to the first semantic change near line 1000 and scrolls |
| `diff-unchanged` | diff | 1400×900 | Show diff + Context; Monaco's native `{n} hidden lines` widgets with unfold control and top/bottom handles |
| `diff-nav` | diff | 1400×900 | two **Next diff** presses; the semantic rename/move row is revealed without a custom ruler mark |
| `diff-one-sided` | diff | 1400×900 | a right-only and a left-only module/container with different line counts; the missing side has no row and shows Monaco's diagonal gap, the owning side keeps its braces, native fill and indicator, and the right-side rows show the copy-left arrow |
| `diff-removed` | diff | 1400×900 | a left-only module with no right-side counterpart; Monaco's built-in right arrow posts the ARXML copy and the shared changed row shows the copy-left arrow |
| `diff-body` | diff | 1400×900 | the fixed body state: unchanged rows, a changed value and rename, added/removed parameters and containers, one-sided blocks, native line/word fills, indicators, a diagonal gap and the built-in margin arrows |
| `diff-wide` | diff | 1400×900 | long parameter names; rows overflow horizontally, the copy-left arrows stay in the modified gutter |
| `diff-wide-panned` | diff | 1400×900 | the same rows panned 600px; the copy-left arrows stay in the modified gutter |
| `editor` | editor | 1400×900 | editor toolbar, gutter and selected Details row |
| `editor-syntax` | editor | 1400×900 | decimal, binary, text, reference and system-condition values; binary matches the numeric colour, references use the reference colour, and condition names/operators/numbers stay distinct |
| `editor-syscond` | editor | 1400×900 | the `Condition` row selected; the Monaco editor condition line and Details Condition code share the macro-blue name, magenta operator, cyan literal and number, and the Conditions panel uses the same name/state colours |
| `editor-labels` | editor | 1400×900 | a module, a normal container, a parameter and a container with no `DEFINITION-REF`; the no-label line starts with its quoted short name in the string colour, and the normal container keeps the label in the type colour and the short name in the string colour |
| `editor-dirty` | editor | 1400×900 | a typed parameter shows the `● Unsaved changes` toolbar marker and posts no host edit before `Ctrl+S` |
| `editor-invalid` | editor | 1400×900 | invalid direct input shows the red marker/error and a `Ctrl+S` attempt is blocked |
| `editor-details` | editor | 1400×900 | typing in the Details value stays local; focus/caret kept, the line repainted, no host edit |
| `editor-details-save` | editor | 1400×900 | `Ctrl+S` sends one raw edit, waits for its ack, saves, then the host echo rebuild keeps Details focus/caret |
| `editor-details-rename` | editor | 1400×900 | a rename is acknowledged before the re-scan; the next save defers and the post-flush keystroke is submitted at the new id |
| `editor-rename-refusal` | editor | 1400×900 | the re-scan lands first, then the host refuses the remapped rename; the refusal is shown inline at the new id and no save follows |
| `editor-rename-late-ack` | editor | 1400×900 | the re-scan lands before the rename acknowledgement; the page keeps the post-flush draft and caret, submits it at the host id and saves |
| `editor-multi-save` | editor | 1400×900 | two fields are edited locally, one `Ctrl+S` posts two edits then one save after both acks, and both new values stay visible |
| `editor-paste` | editor | 1400×900 | a paste containing a newline becomes one escaped line (`\n`), keeps one quote pair and posts no host edit |
| `editor-stale-save` | editor | 1400×900 | a draft whose row disappears from the re-scan blocks `Ctrl+S`, posts no save and explains that the node is gone |
| `editor-details-undo` | editor | 1400×900 | a local undo after a Details edit restores the host value, caret and clean toolbar |
| `editor-details-redo` | editor | 1400×900 | redo after that undo restores the draft, caret and dirty marker without a host edit |
| `editor-delete` | editor | 1400×900 | type, backspace, word-delete, select-and-replace, clear and retype stay local and end at `Text = "R"` |
| `editor-sticky` | editor | 1400×900 | deep scroll into the `Items` container; its header stays pinned by Monaco sticky scroll |
| `editor-find` | editor | 1400×900 | native find widget open on `Items`, with the Rust result count and field highlight |
| `diff-find` | diff | 1400×900 | native find widget in the modified pane, with the Rust diff match count |
| `toolbar-1400` | diff | 1400×900 | full labels; Merge active; Swap over the pane divider |
| `toolbar-1200` | diff | 1200×900 | secondary labels hidden; Context/Semantic/Strict/Merge labels remain |
| `toolbar-1024` | diff | 1024×900 | icon-only 40px tools; Swap over the divider |
| `toolbar-900` | diff | 900×900 | 36px tools; dividers hidden |
| `toolbar-800` | diff | 800×900 | 32px tools; grid still centred |
| `toolbar-640` | diff | 640×900 | 28px tools; native find widget hidden until `Ctrl+F` |

The diff states use a synthetic module with ten changed values; the long states use a
zero-padded parameter list so the first change is near line 1000.

## Self-audit checklist

Run the captures after any change to the toolbar, the gutter, the rows, the diff
strip or the page shell, and check each image before asking for review.

- [ ] **Toolbar never overlaps.** The audit reports no overlapping controls, no control
      outside the viewport, no control clipped by its group, and the Swap action within
      12px of the pane divider at 1400/1200/1024/900/800/640. Check the screenshots too:
      secondary labels drop first, then the primary labels; the find widget is not part
      of the toolbar and opens only on `Ctrl+F`.
- [ ] **Merge is a toolbar action.** `#diff-merge` is in the strip and is visibly
      pressed (`aria-pressed="true"`) in `diff-merge`.
- [ ] **Find is the native widget.** `editor-find` and `diff-find` show Monaco's
      `find-widget` with the `Aa`/`ab|`/`.*` toggles, the native count (`1 of N`) and no
      custom search strip. The audit also requires the editor/tree/diff hosts to allow the
      tooltip to paint over the toolbar while the widget is open.
- [ ] **Diff fills stay translucent.** The native `.line-insert` / `.line-delete` /
      `.char-insert` / `.char-delete` fills keep readable text; the audit rejects opaque
      fills in the dark preview.
- [ ] **A one-sided block exists only on the owning side.** `diff-one-sided` has a
      right-only added module and a left-only removed module; the removed side is one row
      longer, so the per-side models must have different line counts. The audit reads both
      models and the rendered layers: the missing side has no line or brace, Monaco's
      `.diagonal-fill` covers the gap, the owning side keeps its braces and native line fill
      and indicator, and the right-side rows show the copy-left arrow. The
      `oneSided` object records `originalLines`, `modifiedLines`, `native`, `margin` and
      `customPaint`; a blank numbered placeholder or any old custom paint is a failure.
- [ ] **The body contract is present.** Every diff state's audit has `body.host`,
      `body.gutter` and `body.status` true: `#diff-monaco` carries `arxml-diff-body`, and both
      Monaco editor roots carry `arxml-diff-body`, `arxml-diff-gutter` and `arxml-diff-status`.
- [ ] **The `diff-body` state exercises every status and the native body.** Its
      `body.statuses` has changed, added, removed and renamed rows; `body.native` reports
      inserted/deleted line fills, word spans, indicators and a diagonal gap; `body.margin`
      reports at least one visible copy-left arrow in the modified gutter and the click posts
      the host copy for a semantic row. `body.customPaint` must stay zero.
- [ ] **The built-in right arrow posts the ARXML copy.** `diff-removed` has a left-only
      module block, so Monaco renders its own `.arrow-revert-change.codicon-arrow-right` in
      the modified gutter. The probe clicks it and the audit requires `margin.builtIn >= 1`,
      `margin.copy.direction === 'right'`, a left source side and a real removed row key.
      The handler must not call Monaco's synthetic-model revert.
- [ ] **Value kinds keep their colours.** `editor-syntax` shows `0b1010` in the same colour as
      decimal `42`, `P.Syn.Syntax.Target` in the reference colour, and
      `CANIPCORETYPE_SC==0` with distinct name, operator and number colours.
- [ ] **The condition palette is shared.** `editor-syscond` shows the Monaco editor condition line
      and Details `Condition` code with the macro-blue name, magenta operator, cyan literal and
      unchanged numbers; the Conditions panel constant name and state use the same colours and the
      state keeps its dashed border. The legacy tree chip shares the same stylesheet and is covered
      by the CSS/load tests. The audit rejects an editor or Details token that falls back to the
      foreground or a panel colour that drifts from the shared tokens.
- [ ] **A short name is never a definition label.** `editor-labels` shows the no-label
      container line as `"EmptyDef" { }` with the quoted short name in the string colour, and
      the normal container as `Items "Items"` with the label in the type colour and the short
      name in the string colour. The audit rejects a no-label first token that is not the
      string colour, a normal container whose label/short-name colours swapped, and a preview
      that did not select the no-label container.
- [ ] **Dirty typing is visible and coalesced.** `editor-dirty` shows `● Unsaved changes`
      after a multi-character typing run and posts no host edit before `Ctrl+S`.
- [ ] **Invalid input blocks save.** `editor-invalid` shows the page error, posts no edit and
      no save after the `Ctrl+S` attempt.
- [ ] **Details typing stays local and keeps the caret.** `editor-details` shows the redrawn
      editor line, focus and the caret at the end of `#details-value`, and posts no host edit;
      `editor-details-save` sends one raw edit on `Ctrl+S`, posts the save only after the ack,
      and keeps focus/caret after the host echo rebuilds the Details panel.
- [ ] **A rename holds the draft across an early ack.** `editor-details-rename` acknowledges
      the short-name edit before its re-scan, defers the second `Ctrl+S`, then submits the
      post-flush `Syntax23` at the predicted id; the field keeps focus/caret and no
      stale-node notice appears.
- [ ] **A refusal after the renamed re-scan lands at the new id.** `editor-rename-refusal`
      shows the post-flush `Syntax23` addressed at the host's new id, the inline reason beside
      the short-name field, the refusal in the Details status, focus on that control, and no
      save after the refusal.
- [ ] **A late acknowledgement keeps the caret.** `editor-rename-late-ack` delivers the renamed
      re-scan first and the host pair second; the post-flush `Syntax23` still moves to the new
      id, the short-name field keeps focus/caret, and the save follows that edit's ack.
- [ ] **Undo returns to the host value.** `editor-details-undo` undoes the local Details draft,
      restores `hello`, clamps the caret, hides the `● Unsaved changes` marker and posts no
      host edit.
- [ ] **Redo restores the undone draft.** `editor-details-redo` redoes that local undo, restores
      `hello updated`, the caret, the `● Unsaved changes` marker, and posts no host edit.
- [ ] **Delete paths stay local.** `editor-delete` types, backspaces, deletes by word, replaces
      a selection, clears and retypes the textual value; it ends at `Text = "R"`, keeps one
      quote pair, shows the dirty marker and posts no host edit.
- [ ] **Two rows save on one Ctrl+S.** `editor-multi-save` edits `Decimal` and `Text` locally,
      then `Ctrl+S` posts two `edit` messages in values-first order, one `save` after both
      acknowledgements, and shows `Decimal = 427` and `Text = "hello!"` after the host echo.
- [ ] **A pasted newline stays one line.** `editor-paste` pastes `\nsecond` into the `Text`
      value; the line reads `Text = "hello\nsecond"` with the newline escaped, one quote pair,
      and no host edit is posted.
- [ ] **A stale draft blocks the save.** `editor-stale-save` types into `Text`, receives a
      re-scan without that row, and attempts `Ctrl+S`; no edit and no save are posted and the
      Details status says the node is no longer in the file.
- [ ] **Sticky scroll keeps the scope.** `editor-sticky` shows the enclosing `Items` header
      pinned while the viewport is deep in its parameter list.
- [ ] **The dirty marker is visible.** `editor-dirty` shows `● Unsaved changes` in the editor
      toolbar; the audit fails when the status is hidden or empty.
- [ ] **Merge arrows are the built-in diff margin.** Monaco's own
      `.arrow-revert-change.codicon-arrow-right` stays in the modified editor's gutter and
      its click posts the host `copy`. The one extra
      `.arrow-revert-change.codicon-arrow-left` is a zero-height view zone in the same
      gutter; it appears on every changed/added row that owns a right-side cell. Both are
      merge-mode only, and neither adds a custom pill, text arrow or selection tint.
- [ ] **Arrows survive horizontal overflow.** In `diff-wide` and `diff-wide-panned`, the
      copy-left arrows stay inside the modified editor's left gutter at both scroll
      positions; they do not move with the row content.
- [ ] **The gutter rail is right of the digits.** The status edge sits on the
      gutter's inner edge, and a four-digit number is fully visible beside it. The audit
      requires a rail in each pane, on the inner edge (a leading rail fails), with the
      digits clear of the right padding.
- [ ] **No stray rails.** Changed rows show one rail per pane; no vertical bar at the
      outer edge of the right pane.
- [ ] **Swap mirrors the panes.** The audit snapshots the titles and the first changed
      values before the click and requires each side to take the other's after it.
- [ ] **Next diff scrolls.** `diff-rail` starts above line 1000 and the first
      **Next diff** press lands on the first semantic change; the selection and the rail agree.
- [ ] **Show diff keeps native unchanged widgets.** `diff-unchanged` shows
      Monaco's `.diff-hidden-lines` centers, each 24px high with a `{n} hidden lines`
      label, the unfold codicon and two drag handles. The audit records the toggle
      probe: Show all removes every widget, Show diff restores them, and Context off
      hides at least as many rows as Context on. Monaco's `.diffOverview` stays present.
- [ ] **The overview ruler is the built-in diff overview.** `renderOverviewRuler` is on and
      every diff state has `.diffOverview`; the page publishes no semantic `overviewRuler`
      model decorations and no selected-row ruler emphasis.
- [ ] **Prev/Next follow semantic rows.** `body.nav.positionLine` is the semantic
      target line, and `diff-nav` ends on the renamed row while the first Monaco line
      change picks a different row.
- [ ] **Editor page.** Toolbar, line-number gutter, selected row and Details panel
      render without clipping. The `select` state must leave a selected row in the audit.

Record a manual observation with the state name and what changed, for example
“`diff-rail`: F7 lands on line 1007, rail clear of the four digits”.

## How it works

- `scripts/previewWebview.mjs` bundles `src/test/preview/previewData.ts` for Node and
  `src/test/preview/previewPage.ts` for the browser with esbuild, then serves one HTML
  document per state. esbuild emits `dist/preview/preview.js` and `preview.css`; the
  server also serves the bundled `monaco.worker.js` and hashed font assets. It deliberately
  drops the production CSP for this local surface.
- `previewData.ts` calls the production `diffShell`/`editorShell`, injects the supported
  dark-theme token block, seeds a synthetic `DiffDocument` or editor document and inlines the payload.
  The theme block is required: without VS Code's variables the gutter is transparent and the rail can
  be mistaken for a stray edge.
- `previewPage.ts` imports the production page entries. They auto-mount when their
  root is present, exactly as in the extension. The preview then posts the document,
  applies Show diff/Context, toggles Show all and Context for the unchanged-widget
  probe, applies Merge, clicks Swap (after snapshotting the panes), pans the rows,
  presses **Next diff**/**Prev diff** or selects a row, waits a short timer for layout
  and the resize observer, and publishes the audit. Do not call the mount functions again: a second mount binds every
  toolbar action twice, and toggles such as Merge and Swap cancel themselves out.
- `previewAudit.ts` reads the rendered DOM: pane and row widths, horizontal offsets,
  the built-in margin arrow rects and their gutter position, toolbar control rects and
  pairwise intersections, the Swap-to-divider distance, per-pane gutter rails and rail
  side, selected row, Swap before/after titles and values, and page overflow. It turns
  those measurements into violations such as “the copy-left arrow is outside the
  modified gutter” or “the built-in arrow did not post the host copy”.
- `shotWebview.mjs` starts the server, spawns the browser asynchronously once per
  state (`spawnSync`/`execFileSync` blocks the event loop and the server cannot answer
  Chrome), requests `--dump-dom` and `--screenshot` in the same run, extracts the audit
  script from the DOM, writes `<state>.audit.json`, and fails the run on violations.
- Screenshot width/height come from the state manifest. Add a state there and it is
  served, captured, audited and listed automatically.
- The copy-left arrow is a zero-height view zone with a `marginDomNode` in the modified
  editor, so Monaco owns its top, height, scroll tracking and clipping; the page does
  not position it from row widths. The built-in right arrow is Monaco's own view zone.
  Both use `.arrow-revert-change` and are visible only while Merge is on.
- The toolbar stays a three-column grid at every width. Secondary labels drop first,
  then the primary labels; the boxes step 60 → 40 → 36 → 32 → 28px. Find is Monaco's
  own widget inside the editor pane and is absent until `Ctrl+F`.

## Adding a state

1. Add an entry to `STATES` in `src/test/preview/previewData.ts`, with the page,
   size and optional `merge`, `swap`, `wide`, `pan`, `view`, `context`, `jump`,
   `jumpBack` or `select` flags.
2. If the state needs a different fixture, extend `previewHtml` with the payload the
   production page expects; keep using the real host message shapes.
3. Run `npm run shots:webview -- --state <name>`; fix every audit violation before
   looking at the image.
4. Add the state to the table above and to the checklist if it covers a new surface.

## Limits

The harness proves geometry and paint in Chromium at the listed sizes. The audit is a
set of placement invariants, not a taste judgement: still inspect the PNG for colour,
spacing and clipping the invariants do not encode. When Monaco is active the legacy
DOM diff-geometry checks are skipped; the Monaco editor owns its gutter, arrows, scroll
surface and selection. It does not prove VS Code theme fidelity (tokens are seeded), real
keyboard/IME input, screen-reader output or performance; those still need the Extension
Development Host, and a host observation belongs in the task notes as a manual check. The
condition palette is fixed per VS Code theme class, so the screenshot proves the dark
palette; the light and high-contrast values are asserted by the stylesheet tests, not by the
preview. It does prove focus and caret in the Details panel across a local repaint and a host echo, and it invokes
the registered Undo/Redo actions after a Details edit; the Ctrl+Z/Ctrl+Shift+Z keybindings
themselves cannot be driven from the harness, so that route still needs the Extension Development
Host. The paste probe dispatches a clipboard-shaped event to the editor's capture guard; it does
not exercise the OS clipboard or Monaco's own paste handler. A one-sided row exists only on the
owning side, so Monaco paints its native line/char fill and indicator there and a `.diagonal-fill`
view zone on the missing side; that padding carries no model line or line number. Monaco's
built-in diff overview marks the change region; the page adds no semantic ruler decoration.
