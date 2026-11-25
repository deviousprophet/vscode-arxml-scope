# Spike a reusable VS Code webview preview stack

## Goal

Decide how to turn the repo-specific `webview-preview` skill into a reusable cross-project tool built on official Playwright and official VS Code test tooling, without losing the fast deterministic audit loop this repository needs.

## Questions

- Can official Playwright locate and drive a real VS Code webview DOM under `@vscode/test-cli` / `@vscode/test-electron`?
- Which parts of the current skill are generic (browser launch, screenshots, state application, geometry helpers) and which are ARXML-specific (entry imports, fixtures, protocol, audit rules)?
- What is the minimum per-project adapter a second extension would need?
- Is `vscode-extension-tester` still required for real-webview automation, or can official Playwright cover it?
- What are the costs: VS Code download, display/headless requirements, drivers, CI time, platform support, VS Code version pinning and maintenance?
- Which stack should be the reusable core, and which optional layer should drive the real extension?

## Requirements

- Compare at least:
  1. official Playwright + official `@vscode/test-cli` / `@vscode/test-electron`;
  2. official Playwright against a standalone webview shell (current model);
  3. `vscode-extension-tester` / Selenium for real webviews;
  4. community `vscode-test-playwright` as a reference.
- Test or verify webview frame discovery, `acquireVsCodeApi` behavior, state injection, screenshot/trace capture and failure diagnostics.
- Preserve the current fast preview loop as a supported mode, not a fallback that is removed.
- Produce a concrete adapter contract for another VS Code extension.
- Record a recommendation with evidence, tradeoffs and a follow-up implementation outline.

## Acceptance criteria

- [ ] A written comparison matrix covers capability, speed, platform support, webview access, CI cost and maintenance.
- [ ] At least one official-stack experiment demonstrates whether Playwright can reach a VS Code webview.
- [ ] The report identifies which current preview files are generic versus project-specific.
- [ ] A proposed package/skill layout and per-project manifest are documented.
- [ ] A clear recommendation says what to build, what to keep and what not to use.
- [ ] Follow-up implementation tasks are listed and ordered.

## Non-goals

- Implementing the reusable tool in this spike.
- Replacing the current preview skill before the decision.
- Supporting every VS Code version or every extension framework.
- Adding a new CI job.
