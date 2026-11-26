# Implementation plan — reusable webview preview spike

## Phase 1 — Inventory

- [x] Classify every current preview file as generic, shell, ARXML-specific or audit-specific.
- [x] Record which source imports, fixtures and protocol assumptions block reuse.
- [x] Write the adapter contract and a toy extension config.

## Phase 2 — Standalone core

- [x] Create a throwaway `packages/webview-preview` workspace.
- [x] Implement the Playwright runner, static server, `acquireVsCodeApi` shim, state scheduler,
      screenshots, traces, console capture and report JSON.
- [x] Add generic assertions: overflow, clipping, overlap, visibility and console errors.
- [x] Prove it with a minimal toy webview.
- [x] Add an ARXML Scope adapter and compare its report with the current preview.

## Phase 3 — Extension-host spike

- [x] Launch this extension with `@vscode/test-cli` / `@vscode/test-electron`.
- [x] Open the diff/editor webview through a real command.
- [x] Attach Playwright through the Chromium DevTools endpoint and locate the webview frame.
- [x] Record whether `acquireVsCodeApi`, state injection, screenshots and traces work.
- [ ] Repeat with `vscode-extension-tester` and record frame/selector support.
      *(Source-inspected, not executed: it requires a second VS Code + ChromeDriver download and a
      Mocha harness. The report records the frame-switch source and the tradeoff.)*
- [x] Measure setup time, run time, display/headless requirements and failure diagnostics.

## Phase 4 — Decision

- [x] Fill the comparison matrix.
- [x] Recommend the reusable package layout, adapter boundary and optional E2E driver.
- [x] List follow-up implementation tasks in order.
- [x] Archive or mark the throwaway fixtures.

## Validation

- [x] Every spike claim is backed by a command, output or source link.
- [x] Reuse is proved by a second adapter, not by ARXML Scope alone.
- [x] The report says what not to build as clearly as what to build.
- [x] No production `src/` change is required for the spike.

## Rollback

Delete the throwaway workspace and task branch; no production behavior changes.
