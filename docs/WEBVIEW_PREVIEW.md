# Webview preview and screenshots

A development-only harness that serves the **production** webview shell and the real
bundled pages, seeds each page through the host protocol, and captures every state with
a local headless Chrome or Edge. Every capture also writes a rendered-geometry audit:
the page measures its own panes, toolbar, built-in diff gutter/sash, folding and native
diff paint after the gestures, and the runner fails when an action escapes its pane,
overlaps a neighbour or a one-sided hunk offers an impossible copy. The audit exists
because a screenshot can look plausible while the geometry is wrong — a toolbar control
can sit under the Search field, a gutter item can show both directions on a deletion —
and the jsdom suites cannot see layout at all.

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
| `diff-off` | diff | 1400×900 | baseline diff; the built-in gutter and sash are mounted, copy actions are hidden outside Merge |
| `diff-merge` | diff | 1400×900 | Merge pressed; the built-in hunk toolbar offers Copy Block to Left/Right |
| `diff-swap` | diff | 1400×900 | Swap pressed; headers and values mirror, and the copy direction/host side follow the displayed panes |
| `diff-rail` | diff | 1400×900 | long document; F7 jumps to the change near line 1000 and scrolls |
| `diff-one-sided` | diff | 1400×900 | per-side models with changed pairs; native fills and diagonal gaps, no placeholder layers |
| `diff-removed` | diff | 1400×900 | a left-only module deletion; the gutter hides Copy Block to Left and offers only Copy Block to Right |
| `diff-sash` | diff | 1400×900 | built-in sash drag, document replacement and Swap preserve the ratio; double-click resets to 50/50 |
| `diff-wide` | diff | 1400×900 | long parameter names; the panes overflow horizontally |
| `diff-wide-panned` | diff | 1400×900 | the same rows panned 600px; native scrolling stays inside the panes |
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
- [ ] **Diff fills stay translucent.** Changed rows keep readable text; the audit rejects
      opaque line or word fills in the dark preview.
- [ ] **The per-side body has no placeholders.** `diff-one-sided` and `diff-removed` read two
      independently shaped models. The audit requires no `arxml-diff-placeholder` decoration or
      element, a native `.diagonal-fill` for the missing side, the owning side's inserted/deleted
      fill intact, a deletion hunk in `diff-removed`, and unequal model line counts there. The
      `oneSided` object records the models, changes, gutter availability and native paint.
- [ ] **Folding works in both panes.** `diff-merge` starts with the full visible row count,
      `Collapse All` hides rows, and `Expand All` restores the count. The audit records
      `visibleBefore`, `visibleCollapsed`, `visibleExpanded` and the chevron count; chevrons are
      hover-controlled, so the pass condition is the visible-row round trip.
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
- [ ] **The built-in gutter mounts and gates on Merge.** `diff-merge` has a 35px `.gutter`,
      hunk `.gutterItem`s and the Copy Block to Left/Right labels; `diff-off` hides only the
      items and keeps the gutter and sash. The audit rejects a third action, `Revert Block`, or
      any copy while Merge is off.
- [ ] **One-sided hunks hide the impossible action.** `diff-removed` records a gutter item with
      `left: false, right: true` and a single action; clicking it posts `side: "left"` with the
      removed module key. Changed pairs expose both actions.
- [ ] **Swap keeps the displayed-pane meaning.** In `diff-swap` the first action posts the
      stored side now shown in the source pane (`side: "left"` after the swap). The audit derives
      the expected side from the clicked action and the swap flag.
- [ ] **The built-in sash resizes and resets.** `diff-sash` starts at 50/50 (left pane plus the
      35px gutter equals the right pane), drags wider, keeps the ratio after a document
      replacement and Swap, and double-click returns to 50/50. The audit records every width pair.
- [ ] **Swap mirrors the panes.** The audit snapshots the titles and the first changed
      values before the click and requires each side to take the other's after it.
- [ ] **F7 scrolls.** `diff-rail` starts above line 1000 and lands on the first
      changed row; the selection and the rail agree.
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
  applies Merge, clicks Swap (after snapshotting the panes), pans the rows, presses F7
  or selects a row, waits a short timer for layout and the resize observer, and
  publishes the audit. Do not call the mount functions again: a second mount binds every
  toolbar action twice, and toggles such as Merge and Swap cancel themselves out.
- `previewAudit.ts` reads the rendered DOM: pane and row widths, horizontal offsets,
  toolbar control rects and pairwise intersections, the Swap-to-divider distance,
  selected row, Swap before/after titles and values, and page overflow. For the diff
  states it also reads the 35px built-in `.gutter`, per-hunk `.gutterItem` availability,
  action labels, the clicked host copy, the `.monaco-sash`, the folding visible-range
  round trip and the per-side model line counts/paint. It turns those measurements into
  violations such as “the one-sided hunk does not hide Copy Block to Left”.
- `shotWebview.mjs` starts the server, spawns the browser asynchronously once per
  state (`spawnSync`/`execFileSync` blocks the event loop and the server cannot answer
  Chrome), requests `--dump-dom` and `--screenshot` in the same run, extracts the audit
  script from the DOM, writes `<state>.audit.json`, and fails the run on violations.
- Screenshot width/height come from the state manifest. Add a state there and it is
  served, captured, audited and listed automatically.
- The gutter toolbar is VS Code's `DiffEditorGutter`/`DiffToolBar`. The checked-in
  `patches/monaco-editor+0.57.0.patch` scopes a context-key service per hunk so the two
  ARXML actions can hide independently; `diffGutterAvailability.ts` sets those keys for
  the hovered/current hunk. The sash ratio is measured by dragging the real `.monaco-sash`.
- The toolbar stays a three-column grid at every width. Secondary labels drop first,
  then the primary labels; the boxes step 60 → 40 → 36 → 32 → 28px. Find is Monaco's
  own widget inside the editor pane and is absent until `Ctrl+F`.

## Adding a state

1. Add an entry to `STATES` in `src/test/preview/previewData.ts`, with the page,
   size and optional `merge`, `swap`, `wide`, `pan`, `jump`, `select` or `sash` flags.
2. If the state needs a different fixture, extend `previewHtml` with the payload the
   production page expects; keep using the real host message shapes.
3. Run `npm run shots:webview -- --state <name>`; fix every audit violation before
   looking at the image.
4. Add the state to the table above and to the checklist if it covers a new surface.

## Limits

The harness proves geometry and paint in Chromium at the listed sizes. The audit is a
set of placement invariants, not a taste judgement: still inspect the PNG for colour,
spacing and clipping the invariants do not encode. The diff body is Monaco's; the audit
reads its per-side models, native diagonal fill, fills and gutter rather than a rebuilt
DOM. The checked-in Monaco patch only scopes the gutter menu context; a fresh
`npm install`/`npm ci` must run `patch-package` (the `postinstall` script) or the gutter
audit fails. Folding is an intentional deviation from stock VS Code diff behavior: both
inner editors re-enable `folding` and the ARXML Collapse/Expand actions drive them.
It does not prove VS Code theme fidelity (tokens are seeded), real
keyboard/IME input, screen-reader output or performance; those still need the Extension
Development Host, and a host observation belongs in the task notes as a manual check. The
condition palette is fixed per VS Code theme class, so the screenshot proves the dark
palette; the light and high-contrast values are asserted by the stylesheet tests, not by the
preview. It does prove focus and caret in the Details panel across a local repaint and a host echo, and it invokes
the registered Undo/Redo actions after a Details edit; the Ctrl+Z/Ctrl+Shift+Z keybindings
themselves cannot be driven from the harness, so that route still needs the Extension Development
Host. The paste probe dispatches a clipboard-shaped event to the editor's capture guard; it does
not exercise the OS clipboard or Monaco's own paste handler. The overview ruler marks the
change region; the missing side relies on Monaco's diagonal view zone, which is not a model
line and carries no added or removed tint.
