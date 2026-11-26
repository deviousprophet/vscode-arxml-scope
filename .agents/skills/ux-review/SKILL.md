---
name: ux-review
description: "Run the real VS Code UX-review host: launch ARXML Scope in an Extension Development Host, drive webviews with Playwright over CDP, record journeys, capture metrics (window/webview size, zoom, DPR), continuity probes and screenshots. Use for UX audits, not layout-only preview captures."
---

# UX Review Host

The reusable real-host half of the ARXML Scope UX review. The `webview-preview` skill covers
seeded rendered states; this skill covers commands, dialogs, keyboard, focus, zoom, save/copy and
error paths in a real VS Code window. The `ux-reviewer` agent owns the rubric, journey matrix and
report; this skill owns the executable harness.

All paths below are relative to this skill directory (`.agents/skills/ux-review/`).

## When to use

- A UX review needs real commands, the command palette, native dialogs, tabs, notifications,
  focus or keyboard input.
- A finding depends on the real webview width, zoom, side bar/auxiliary bar or window size.
- A save/copy/rename/refresh needs a before/after continuity probe.
- The `webview-preview` seeded states cannot render the surface (errors, empty, dialogs, host
  chrome).

Not for ordinary unit tests, layout-only captures or CSS changes that `webview-preview` covers.

## Prerequisites

```powershell
npm install
npm --prefix packages/webview-preview install   # Playwright lives here
node esbuild.js
node scripts/build-engine.mjs --debug
```

`@vscode/test-electron` is at the repo root. The runner uses the installed VS Code and a fresh
temporary profile; it never touches the user's settings or workspace.

## Commands

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

## Scenarios

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

## What the runner does

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

## Capture fidelity

Every `shot()` records:

- workbench `innerWidth`/`innerHeight`, `devicePixelRatio`;
- webview frame `innerWidth`/`innerHeight`, `devicePixelRatio`;
- the scenario name and screenshot paths.

The workbench and webview widths are not interchangeable. A 1440×900 window with a side bar or
Chat leaves roughly 780–1080 CSS px for the webview; the preview skill’s 1400 px page is not host
parity. For width-sensitive findings, capture at 100% and 80% zoom (the `capture-fidelity`
scenario) and report the measured webview width and zoom. `window.zoomLevel` may still read 0
after `workbench.action.zoomOut`; use the frame width and DPR as the effective measurement.

## Continuity

For save, copy, undo/redo, rename, refresh, settings/theme and document patch, the driver records
scroll, selection/caret, focus, folds, active pane and markers before/after. Scroll and selection
are independent: a save can keep the scroll anchor and focus while Details jumps to another row.
Run `save-continuity` against a large document scrolled away from the top; a top-of-file fixture
cannot expose this class.

## Outputs

- `driver-report.json` — scenarios, checks, observations, `captures[]` with sizes/DPR.
- `<scenario>-workbench.png` — full window (chrome, tabs, dialogs).
- `<scenario>-webview.png` — frame body (content).
- `host-run.json` / `host-activation.json` — launch and activation facts.
- `missing-engine/` — the activation-failure run.

By default `artifacts/` is ignored. When the review must continue on another machine, set
`HOST_OUT` to a tracked task evidence directory and commit the PNGs and JSON; keep only large
traces local with a note. The report should link the committed paths.

## Extending

- Add a `scenario('name', async ({ check, record }) => …)` in `driver.mjs`.
- Use `B('/exec', { command })`, `B('/openWith', …)`, `B('/setting', …)` for host setup; keep the
  user-facing steps in Playwright.
- `suite.cjs` hardcodes the extension id `deviousprophet.vscode-arxml-scope`; `driver.mjs` uses
  ARXML commands, selectors and fixtures. Adapt both for another extension.
- Do not add a second copy of the runner under `src/test` or `scripts/`.

## Limits and cleanup

- Development host, not a marketplace VSIX; some host chrome differs from a user install.
- Real keyboard/IME, OS clipboard and screen-reader output are only partially observable.
- A display is required; Linux CI needs `xvfb`.
- The runner closes VS Code, Chrome/Playwright and the bridge and removes its temp directories on
  every exit path. If a run is killed, remove `%TEMP%\arxml-ux-host-*` manually.
