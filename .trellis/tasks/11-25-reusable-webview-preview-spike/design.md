# Design — reusable webview preview spike

## Direction

Do not start from the current repo-specific skill. Start from a standalone package that can preview
any VS Code webview through a small per-extension adapter. The skill becomes a usage wrapper, not
the implementation.

## Target package

```text
packages/webview-preview/
  src/
    cli.ts
    runner/playwright.ts
    runner/report.ts
    runner/screenshots.ts
    runner/console.ts
    assertions/generic/
    modes/standalone.ts
    modes/extensionHost.ts
    webview/serve.ts
    webview/vscodeApiShim.ts
    adapters/contract.ts
```

The core must not import extension source, fixtures or product selectors. Each extension supplies a
config and adapter.

## Two modes

### 1. Standalone webview mode — fast inner loop

- Consume a built webview bundle, not source imports.
- Serve HTML/JS/CSS with a generic static server.
- Inject a generic `acquireVsCodeApi` shim.
- Use official `@playwright/test` for Chromium, screenshots, traces, console/network capture and
  fixtures.
- Apply a project state by posting messages or running an adapter callback.
- Run generic assertions plus project-provided audit functions.

### 2. Real extension-host mode — E2E proof

- Use official `@vscode/test-cli` / `@vscode/test-electron` to launch VS Code with the extension.
- Open the webview through a real command.
- Attach Playwright to the VS Code renderer through the Chromium DevTools endpoint, then locate the
  webview frame.
- If that is unreliable, keep `vscode-extension-tester` as a replaceable webview driver, not as the
  core.

## Adapter contract

```ts
export default definePreview({
  name: 'arxml-scope',
  build: {
    command: 'npm run build:webview',
    outDir: 'dist/webview'
  },
  entry: 'diff.html',
  states: [
    {
      name: 'diff-merge',
      viewport: { width: 1400, height: 900 },
      setup: async (page) => {
        await page.evaluate(() => {
          window.postMessage({ type: 'mergeMode', enabled: true }, '*');
        });
      }
    }
  ],
  audits: [
    noHorizontalOverflow(),
    noClippedControls(),
    arxmlGutterAudit(),
    arxmlFoldAudit()
  ]
});
```

Generic core:

- state scheduling, waits and settling;
- screenshots and traces;
- console/network capture;
- visibility, overlap, clipping and overflow checks;
- report JSON and CI exit codes.

Project adapter:

- fixture builders;
- protocol messages;
- selectors;
- page-specific probes;
- product invariants.

## Spike experiments

1. Build the standalone Playwright runner against a minimal toy webview.
2. Add a second adapter for this repo's built diff/editor pages.
3. Launch the real extension with `@vscode/test-cli` / `@vscode/test-electron`.
4. Attach Playwright through the DevTools endpoint and locate the webview iframe.
5. Compare with `vscode-extension-tester` for frame/selector support, speed and CI cost.
6. Record which mode catches which class of regression.

## Build order

1. Define the adapter and state manifest.
2. Build standalone mode.
3. Prove reuse with a toy extension.
4. Add the ARXML adapter.
5. Spike real-extension webview attach.
6. Decide Playwright/CDP versus ExTester for real-webview driving.
7. Publish the package and make the skill a one-page CLI guide.

## Decision

The spike must choose one of:

- one package with standalone and official Playwright extension-host modes;
- one package with standalone Playwright plus ExTester as the real-webview driver;
- defer extension-host mode and ship the standalone reusable core first.

## What not to do

- Do not import extension page modules into the generic runner.
- Do not put fixtures or product audits in the core.
- Do not make the generic runner know product semantics.
- Do not build both modes before the official-stack spike proves webview attach.

## Rollback

The spike is research plus throwaway fixtures only; no production path changes.
