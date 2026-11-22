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
| `diff-merge` | diff | 1400×900 | Merge pressed; copy arrows on both panes |
| `diff-swap` | diff | 1400×900 | Swap pressed; headers and values mirror, arrows follow |
| `diff-rail` | diff | 1400×900 | long document; F7 jumps to the change near line 1000 and scrolls |
| `diff-wide` | diff | 1400×900 | long parameter names; rows overflow horizontally, arrows stay on the pane edges |
| `diff-wide-panned` | diff | 1400×900 | the same rows panned 600px; both arrows stay on the inner edges |
| `editor` | editor | 1400×900 | editor toolbar, gutter and selected Details row |
| `editor-syntax` | editor | 1400×900 | decimal, binary, text and reference values; binary matches the numeric colour and references use the reference colour |
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
- [ ] **Value kinds keep their colours.** `editor-syntax` shows `0b1010` in the same colour as
      decimal `42`, and `P.Syn.Syntax.Target` in the reference colour rather than the string colour.
- [ ] **Copy arrows are visible without hover.** Both panes show an arrow on the
      changed rows; the left arrow points right, the right arrow points left. The audit
      reports an arrow in each pane, on the inner edge, visible and with an opaque
      background.
- [ ] **Arrows survive horizontal overflow.** In `diff-wide` and `diff-wide-panned`,
      the arrows stay inside the pane rect and on the inner edge at both scroll
      positions. This is the check that catches an arrow pinned to the row's content
      edge instead of the viewport edge.
- [ ] **Arrows do not move text.** The 22px strip is reserved on the pane's inner
      edge in both modes; toggling Merge may show or hide a glyph but never reflows
      the row.
- [ ] **The gutter rail is right of the digits.** The status edge sits on the
      gutter's inner edge, and a four-digit number is fully visible beside it. The audit
      requires a rail in each pane, on the inner edge (a leading rail fails), with the
      digits clear of the right padding.
- [ ] **No stray rails.** Changed rows show one rail per pane; no vertical bar at the
      outer edge of the right pane.
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
  arrow rects, edge gaps, visibility and opacity, toolbar control rects and pairwise
  intersections, the Swap-to-divider distance, per-pane gutter rails and rail side,
  selected row, Swap before/after titles and values, and page overflow. It turns those
  measurements into violations such as “left copy arrow is outside its pane”.
- `shotWebview.mjs` starts the server, spawns the browser asynchronously once per
  state (`spawnSync`/`execFileSync` blocks the event loop and the server cannot answer
  Chrome), requests `--dump-dom` and `--screenshot` in the same run, extracts the audit
  script from the DOM, writes `<state>.audit.json`, and fails the run on violations.
- Screenshot width/height come from the state manifest. Add a state there and it is
  served, captured, audited and listed automatically.
- The arrow overlay is positioned from the **rendered** row width, not the content
  estimate: the row can be a few pixels wider than the pre-layout number, and that gap
  is exactly what pushed the arrow off the pane. A `ResizeObserver` re-runs the offset
  when the shared vertical scrollbar changes a pane's width.
- The toolbar stays a three-column grid at every width. Secondary labels drop first,
  then the primary labels; the boxes step 60 → 40 → 36 → 32 → 28px. Find is Monaco's
  own widget inside the editor pane and is absent until `Ctrl+F`.

## Adding a state

1. Add an entry to `STATES` in `src/test/preview/previewData.ts`, with the page,
   size and optional `merge`, `swap`, `wide`, `pan`, `jump` or `select` flags.
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
surface and selection. It does not prove VS Code theme fidelity (tokens are seeded), keyboard focus
behaviour, screen-reader output or performance. Those still need the Extension Development
Host, and a host observation belongs in the task notes as a manual check.
