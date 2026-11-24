---
name: webview-preview
description: "Render and capture the real ARXML Scope webview pages in headless Chrome/Edge, read the seeded geometry audits, and inspect the PNGs. Use when asked to preview, screenshot, visually check, or debug the webview, editor, diff, toolbar or sidebar layout."
---

# Webview Preview

This skill is the single home of the webview preview/capture harness. The runners, preview page, fixtures, audit and state fields all live here; do not add a second copy under `src/test` or `scripts/`.

## When to use

Use for layout, CSS, toolbar, editor, diff-body, sidebar or search visual changes. Not for ordinary unit-test failures that do not affect rendering.

## Commands

Run from any directory; the scripts resolve the repository root from their own location.

```bash
# List every seeded state
node <skill-dir>/scripts/shotWebview.mjs --list

# Capture one state
node <skill-dir>/scripts/shotWebview.mjs --state diff-merge

# Capture every state
node <skill-dir>/scripts/shotWebview.mjs

# Serve the preview interactively
node <skill-dir>/scripts/previewWebview.mjs [--port 4173]
```

The package aliases are:

```bash
npm run shots:webview -- --list
npm run shots:webview -- --state <name>
npm run preview:webview -- --port 4180
```

`<skill-dir>` is `.agents/skills/webview-preview` in this repository. Set `CHROME_PATH` to override the detected Chrome/Edge.

The preview needs `dist/monaco.worker.js`; run `npm run compile` or `npm run package` first if it is missing.

## Outputs

- `<skill-dir>/artifacts/<state>.png` — the rendered page.
- `<skill-dir>/artifacts/<state>.audit.json` — the rendered geometry/paint audit.
- `<skill-dir>/.cache/` — the generated browser bundle and assets; temporary.

## Workflow for an agent

1. Run `--list` and pick the narrowest state that exercises the change.
2. Capture it: `--state <name>`.
3. Read `<state>.audit.json` **first**. If `violations` is non-empty, fix those before looking at the image.
4. Inspect `<state>.png` with the image viewer. The audit is not a taste judgement; check spacing, colour, clipping and the actual layout.
5. Recapture the same state after the fix.
6. For layout changes, run the full seeded set.

## Cleanup

The shot runner kills the browser process tree, closes the preview server and removes the temporary browser profile on every exit path. Do not leave a browser, a preview server or a temp profile running. `previewWebview.mjs` keeps serving until stopped intentionally.

## Limits

- The shell is the production webview shell with seeded fixtures; it is not the Extension Development Host.
- The preview is dark-theme oriented; light/HC host values are covered by stylesheet tests, not by a second capture shell.
- It does not prove real keyboard/IME input, screen-reader output, OS clipboard behavior or packaged VSIX behavior.
- It is an AI/dev tool, not a user-facing extension feature.
