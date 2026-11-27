---
name: ux-review
description: "Run the ARXML Scope UX review: capture seeded webview states in headless Chrome/Edge with geometry audits, drive the real VS Code Extension Development Host with Playwright over CDP for commands, keyboard, dialogs, capture metrics and continuity, and apply a VS Code-adapted design-review lens for tokens, states, focus, density and recovery. Use for UX audits, layout checks and real-host journeys."
---

# UX Review

Two evidence modes, one design-review lens:

| Mode | Use for | Stack |
|---|---|---|
| **Preview** | Rendered webview states, layout, CSS, toolbar, editor, diff, sidebar | Headless Chrome/Edge + seeded states |
| **Host** | Commands, dialogs, keyboard/focus, save/copy continuity, window/zoom metrics | VS Code Extension Development Host + Playwright CDP |
| **Design review** | UI quality after evidence: tokens, eight states, focus, density, hierarchy, recovery | Screenshots + DOM/source; adapted gate model |

The former `webview-preview` skill has been merged here. Do not add a second copy of the preview or host
runner under `src/test` or `scripts/`.

## When to use

- **Preview:** layout, CSS, toolbar, editor, diff-body, sidebar or search visual changes.
- **Host:** a journey needs real commands, the palette, native dialogs, tabs, notifications,
  focus/keyboard, a real webview width/zoom, or a before/after continuity probe.

Not for ordinary unit-test failures that do not affect rendering.

## Preview mode

Run from any directory; the scripts resolve the repository root from their own location.

```bash
# List every seeded state
node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --list

# Capture one state
node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --state diff-merge

# Capture every state
node .agents/skills/ux-review/scripts/preview/shotWebview.mjs

# Serve the preview interactively
node .agents/skills/ux-review/scripts/preview/previewWebview.mjs [--port 4173]
```

Set `CHROME_PATH` to override the detected Chrome/Edge. The preview needs
`dist/monaco.worker.js`; run `npm run compile` or `npm run package` first if it is missing.

Outputs:

- `.agents/skills/ux-review/artifacts/<state>.png` — the rendered page.
- `.agents/skills/ux-review/artifacts/<state>.audit.json` — the rendered geometry/paint audit.
- `.agents/skills/ux-review/.cache/` — generated browser bundle and assets.

Workflow:

1. Run `--list` and pick the narrowest state that exercises the change.
2. Capture it with `--state <name>`.
3. Read `<state>.audit.json` **first**. Non-empty `violations` block review; fix those before
   looking at the image.
4. Inspect `<state>.png`; the audit is not a taste judgement.
5. Recapture the same state after a fix; for layout changes, run the full seeded set.

Preview limits: the shell is the production webview with seeded fixtures, not the Extension
Development Host; it is dark-theme oriented, does not prove real keyboard/IME, screen-reader, OS
clipboard or packaged-VSIX behavior. The 43-state table and limits are in
[`references/WEBVIEW_PREVIEW.md`](references/WEBVIEW_PREVIEW.md).

## Design review

After the Preview/Host evidence exists, apply the VS Code-adapted lens in
[`references/DESIGN_REVIEW.md`](references/DESIGN_REVIEW.md). It uses an internal
floor/reflex/finish gate model to a desktop IDE; VS Code and this repository's `DESIGN.md` win on
every conflict.

- **Floor** (never waivable): theme tokens, contrast, keyboard/focus-visible, reduced motion,
  truthful save/copy/restart state, complete states, layout integrity at real widths/zoom and
  recovery from stale/refused states.
- **Reflex** (challenge the default): anonymous icon-only toolbars, duplicate refusal channels,
  inert pressed controls, colour-only status, nested chrome, placeholder labels, developer jargon,
  optimistic success.
- **Finish** (craft): alignment, density, icon/tooltip consistency, real counts and empty/error
  copy.

Run it as a cold review: screenshots first, source only to locate; at most eight findings; first
word `rebuild`, `fix` or `ship`; name what must not be diluted. Map findings into the existing
four scoring dimensions; do not add a fifth score. Do not import marketing-page rules from
external web design guidance.
(hero, word budget, themes, 44px touch, 320–1920 breakpoints).

## Host mode

## Host prerequisites

```powershell
npm install
npm --prefix packages/webview-preview install   # Playwright lives here
node esbuild.js
node scripts/build-engine.mjs --debug
```

`@vscode/test-electron` is at the repo root. The runner uses the installed VS Code and a fresh
temporary profile; it never touches the user's settings or workspace.

## Host commands

Run from the repository root:

```powershell
# Full host matrix
node .agents/skills/ux-review/scripts/host/run.mjs

# One or more scenarios
$env:UX_HOST_ONLY='gate,capture-fidelity'
node .agents/skills/ux-review/scripts/host/run.mjs

# Missing-engine path (hides the staged binary, restores it in finally)
$env:UX_HOST_MODE='missing-engine'
node .agents/skills/ux-review/scripts/host/run.mjs

# Write artifacts into a task's research directory
$env:HOST_OUT='.trellis/tasks/<task>/research/evidence/host'
node .agents/skills/ux-review/scripts/host/run.mjs
Remove-Item Env:HOST_OUT, Env:UX_HOST_ONLY, Env:UX_HOST_MODE
```

Default output: `artifacts/host/` under this skill (ignored by git).

## Host scenarios

| Scenario | Covers |
|---|---|
| `gate` | Open ECUC editor, select first, compare, load diff |
| `capture-fidelity` | Window/webview size, DPR, 100% vs 80% zoom |
| `edit` | Select, type, Details, save |
| `save-continuity` | Scrolled large document; save; scroll/selection/focus continuity |
| `compare-two` | Compare two files |
| `diff` | Semantic/strict, find, next, toolbar widths |
| `merge` | Merge on, copy, save paths |
| `stale-copy` | Stale-snapshot guard (may not reproduce) |
| `stale-node` | Save refusal after the row disappears |
| `engine-index` | Engine status, rebuild index |
| `a11y` | Palette, focus order, tab order |
| `stale-first` | Deleted first file |
| `same-file` | Same file twice |
| `missing-engine` | Activation failure path (only in `UX_HOST_MODE=missing-engine`) |
| `edit-invalid` | Invalid draft across toolbar/strip/inline/status; blocked save; fix and save |
| `edit-details-save` | Details-first save; focus and caret after the host echo |
| `edit-multi-save` | Two drafts, one `Ctrl+S`, both values written |
| `row-menu` | Row context menu + Duplicate Quick Input; native confirmation is not reachable over CDP |
| `conditions-tab` | Add/edit, invalid name, save, clear; disabled-row count changes |
| `reveal-modes` | `beside` / `focus` / `replace` plus source → editor reveal |
| `find-replace` | Native find count; replace is a recorded gap (closed shadow root) |
| `settings-sort` | `ecuc.editor.sort` re-renders an open panel live |
| `diff-collapse-all` | Collapse All / Expand All row counts |
| `diff-showdiff-swap` | Swap, Show diff, Context on a long pair |
| `diff-identical` | Identical files → stated empty result |
| `diff-side-not-ecuc` | A side stops being ECUC; last good + notice |
| `merge-collision` | Copy refused when the target lacks the module |
| `merge-subtree` | Container copy carries its subtree |
| `merge-off` | No visible copy action outside Merge |
| `index-toggles` | Enable/disable, exclude, size cap, cross-file cycle |
| `engine-restart` | Show status, Restart Engine, pid replaced |
| `theme-zoom` | Light/high-contrast colours, 150 % toolbar layout |
| `first-gate` | Empty/malformed/non-ECUC open command |

The `deep-*` scenarios were added for the deep-discovery pass. They call `ensureChatClosed()` so the
recorded frame width is stable, and `openEditorOnly()` where the reveal modes need no pre-existing
text tab. Two host limits are known: native modal dialogs (Delete/Duplicate confirmation and the
stale-snapshot Reload/Cancel) do not render in the captured page, so those confirmations cannot be
driven over CDP; and the native find widget's inputs live in a closed shadow root, so only its
text/count is readable and the replace row is not drivable. Record those as `N/A`, not as product
defects.

## What the host runner does

1. Creates a fresh `%TEMP%\arxml-ux-host-ws-*` workspace from
   `src/test/fixtures/diff/{left,right}.arxml` and a fresh profile.
2. Launches the installed VS Code with the extension development path and
   `--remote-debugging-port`.
3. `suite.cjs` activates the extension, starts a localhost bridge (`/exec`, `/openWith`,
   `/openText`, `/setting`, `/config`, `/state`, `/writeFile`, `/delete`, `/save`, `/saveAll`,
   `/hasCommand`) and spawns `driver.mjs`.
4. `driver.mjs` connects with Playwright over CDP, targets the nested
   `vscode-webview://…/active-frame`, and runs real clicks, typing, keyboard shortcuts and
   screenshots.
5. Writes `driver-report.json` (scenario checks, observations, capture metrics), workbench and
   webview PNGs, then removes the temp workspace/profile and restores the engine binary.

## Host capture fidelity

Every `shot()` records:

- workbench `innerWidth`/`innerHeight`, `devicePixelRatio`;
- webview frame `innerWidth`/`innerHeight`, `devicePixelRatio`;
- the scenario name and screenshot paths.

The workbench and webview widths are not interchangeable. A 1440×900 window with a side bar or
Chat leaves roughly 780–1080 CSS px for the webview; the preview skill’s 1400 px page is not host
parity. For width-sensitive findings, capture at 100% and 80% zoom (the `capture-fidelity`
scenario) and report the measured webview width and zoom. `window.zoomLevel` may still read 0
after `workbench.action.zoomOut`; use the frame width and DPR as the effective measurement.

## Host continuity

For save, copy, undo/redo, rename, refresh, settings/theme and document patch, the driver records
scroll, selection/caret, focus, folds, active pane and markers before/after. Scroll and selection
are independent: a save can keep the scroll anchor and focus while Details jumps to another row.
Run `save-continuity` against a large document scrolled away from the top; a top-of-file fixture
cannot expose this class.

## Host outputs

- `driver-report.json` — scenarios, checks, observations, `captures[]` with sizes/DPR.
- `<scenario>-workbench.png` — full window (chrome, tabs, dialogs).
- `<scenario>-webview.png` — frame body (content).
- `host-run.json` / `host-activation.json` — launch and activation facts.
- `missing-engine/` — the activation-failure run.

By default `artifacts/` is ignored. When the review must continue on another machine, set
`HOST_OUT` to a tracked task evidence directory and commit the PNGs and JSON; keep only large
traces local with a note. The report should link the committed paths.

## Extending the host runner

- Add a `scenario('name', async ({ check, record }) => …)` in `driver.mjs`.
- Use `B('/exec', { command })`, `B('/openWith', …)`, `B('/setting', …)` for host setup; keep the
  user-facing steps in Playwright.
- `suite.cjs` hardcodes the extension id `deviousprophet.vscode-arxml-scope`; `driver.mjs` uses
  ARXML commands, selectors and fixtures. Adapt both for another extension.
- Do not add a second copy of the runner under `src/test` or `scripts/`.

## Host limits and cleanup

- Development host, not a marketplace VSIX; some host chrome differs from a user install.
- Real keyboard/IME, OS clipboard and screen-reader output are only partially observable.
- A display is required; Linux CI needs `xvfb`.
- The runner closes VS Code, Chrome/Playwright and the bridge and removes its temp directories on
  every exit path. If a run is killed, remove `%TEMP%\arxml-ux-host-*` manually.
