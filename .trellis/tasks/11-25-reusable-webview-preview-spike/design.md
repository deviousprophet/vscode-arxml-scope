# Design — reusable webview preview spike

## Current split

Generic candidates:

- headless browser launch, screenshot and trace capture;
- state scheduling and wait helpers;
- geometry helpers, overlap/clipping checks, visibility checks;
- report/exit-code plumbing;
- a manifest for viewport, states and probes.

Project-specific today:

- `previewPage.ts` imports `src/webview/diffMonaco` and `src/webview/editorMonaco`;
- `previewData.ts` builds ARXML fixtures with `scanEcucValues`, `buildRows` and `buildDiffDocument`;
- state names and protocol messages;
- audit rules for gutter, folds, sticky headers, merge and navigation.

## Candidate stacks

### A. Official Playwright + `@vscode/test-cli` / `@vscode/test-electron`

- Official extension-host runner; Playwright is not connected to the webview frame by VS Code.
- Possible approaches to test:
  - launch VS Code through `@vscode/test-electron` and attach Playwright through the Electron API (`_electron.launch`) — unsupported by VS Code but technically possible;
  - find the webview iframe in the workbench page and use Playwright frames;
  - use `@vscode/test-cli` only for extension-host/API tests and keep webview rendering in a standalone shell.
- Must verify CSP, `acquireVsCodeApi`, iframe origin, reload behavior, and whether the extension's webview HTML is reachable.

### B. Standalone webview shell + official Playwright

- Current model: bundle the real page modules, serve the production shell, shim `acquireVsCodeApi`.
- Fast, deterministic, no VS Code download, cross-platform headless.
- Per-project adapter must provide entry modules, shell HTML, fixture builders, protocol messages and probes.
- Cannot prove extension-host wiring, activation, VSIX packaging or real webview frame behavior.

### C. `vscode-extension-tester` / Selenium

- Real VS Code, real extension and real webviews.
- Page objects include web views; frame switching is supported.
- Heavier: VS Code download, ChromeDriver, display/xvfb, slower CI.
- Likely the realistic path for true webview E2E if official Playwright cannot attach.

### D. `vscode-test-playwright`

- Community Playwright wrapper around VS Code UI automation; useful reference for API calls, traces and VS Code context evaluation.
- Small project; still needs a webview frame bridge and project adapter.

## Proposed shape

A reusable package with:

- `core/`: Playwright runner, state scheduler, screenshot/trace writer, generic assertions.
- `vscode-webview/`: shell server, `acquireVsCodeApi` shim, frame discovery and protocol bridge.
- `adapter/`: project manifest with entry modules, shell, fixtures, states, probes and audit plugins.
- `extester/` optional: real-extension E2E adapter for webview selectors.

ARXML Scope remains the first adapter; the current `webview-preview` skill becomes a thin wrapper.

## Spike experiments

1. Build a minimal "hello webview" extension or reuse this repo's built extension.
2. Start it under `@vscode/test-cli` / `@vscode/test-electron`; capture the workbench page; locate the webview iframe.
3. Try Playwright Electron attach against the VS Code executable and record whether it reaches the same frame.
4. Try the same webview through `vscode-extension-tester` and record the selector/frame API.
5. Measure setup time, run time, display requirement and failure diagnostics for each path.
6. Map the current skill files onto the generic/adapter split.

## Decision record

The spike must end with one of:

- build core + adapter on official Playwright, with ExTester only for real-webview E2E;
- keep two layers: standalone Playwright preview and ExTester E2E;
- defer the generic tool if the official stack cannot reach webviews reliably.

## Rollback

The spike is research plus throwaway fixtures only; no production path changes.
