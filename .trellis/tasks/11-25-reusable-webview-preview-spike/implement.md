# Implementation plan — reusable webview preview spike

## Phase 1 — Inventory the current skill

- [ ] List every file under `.agents/skills/webview-preview/` and classify it as generic, shell-specific, ARXML-specific or audit-specific.
- [ ] Record which imports and fixtures prevent reuse today.
- [ ] Write the minimal adapter contract a second extension would provide.

## Phase 2 — Official stack experiment

- [ ] Create a throwaway webview extension fixture or use the built ARXML Scope extension.
- [ ] Launch it with `@vscode/test-cli` / `@vscode/test-electron`.
- [ ] Capture the workbench page and locate the webview iframe.
- [ ] Attempt Playwright Electron attach and/or Playwright frame automation.
- [ ] Record whether `acquireVsCodeApi`, state injection, screenshots and traces work.
- [ ] Record setup time, run time, display/headless requirement and failure messages.

## Phase 3 — ExTester comparison

- [ ] Run the same webview through `vscode-extension-tester`.
- [ ] Record frame/selector support, screenshot quality, speed and CI requirements.
- [ ] Note whether ExTester is required only for real-extension E2E or also for the preview loop.

## Phase 4 — Decision

- [ ] Fill the comparison matrix in the research report.
- [ ] Recommend the core, the adapter boundary and the optional E2E layer.
- [ ] List follow-up implementation tasks in order.
- [ ] Archive the throwaway experiments or mark them clearly.

## Validation

- [ ] Every spike claim is backed by a command, output or source link.
- [ ] The report says what not to build as clearly as what to build.
- [ ] No production `src/` change is required for the spike.

## Rollback

Delete the throwaway fixtures and the task branch; no production behavior changes.
