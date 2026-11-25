# Implementation plan — reusable webview preview spike

## Phase 1 — Inventory

- [ ] Classify every current preview file as generic, shell, ARXML-specific or audit-specific.
- [ ] Record which source imports, fixtures and protocol assumptions block reuse.
- [ ] Write the adapter contract and a toy extension config.

## Phase 2 — Standalone core

- [ ] Create a throwaway `packages/webview-preview` workspace.
- [ ] Implement the Playwright runner, static server, `acquireVsCodeApi` shim, state scheduler,
      screenshots, traces, console capture and report JSON.
- [ ] Add generic assertions: overflow, clipping, overlap, visibility and console errors.
- [ ] Prove it with a minimal toy webview.
- [ ] Add an ARXML Scope adapter and compare its report with the current preview.

## Phase 3 — Extension-host spike

- [ ] Launch this extension with `@vscode/test-cli` / `@vscode/test-electron`.
- [ ] Open the diff/editor webview through a real command.
- [ ] Attach Playwright through the Chromium DevTools endpoint and locate the webview frame.
- [ ] Record whether `acquireVsCodeApi`, state injection, screenshots and traces work.
- [ ] Repeat with `vscode-extension-tester` and record frame/selector support.
- [ ] Measure setup time, run time, display/headless requirements and failure diagnostics.

## Phase 4 — Decision

- [ ] Fill the comparison matrix.
- [ ] Recommend the reusable package layout, adapter boundary and optional E2E driver.
- [ ] List follow-up implementation tasks in order.
- [ ] Archive or mark the throwaway fixtures.

## Validation

- [ ] Every spike claim is backed by a command, output or source link.
- [ ] Reuse is proved by a second adapter, not by ARXML Scope alone.
- [ ] The report says what not to build as clearly as what to build.
- [ ] No production `src/` change is required for the spike.

## Rollback

Delete the throwaway workspace and task branch; no production behavior changes.
