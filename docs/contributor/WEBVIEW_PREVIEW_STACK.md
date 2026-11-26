# Reusable webview preview stack - spike decision

Status: spike complete. Implementation has **not** started; the fixture under
`packages/webview-preview/` is throwaway evidence.

Canonical for: the stack decision, the experiment evidence, and the adapter boundary.

Not canonical for: preview commands (that stays in
[`../../.agents/skills/webview-preview/SKILL.md`](../../.agents/skills/webview-preview/SKILL.md))
or product audit invariants (that stays in
[`../../.trellis/spec/frontend/preview-audit.md`](../../.trellis/spec/frontend/preview-audit.md)).

## Decision

Build **one reusable package with two modes**, and keep the current fast loop as the default:

1. **Standalone mode (core, default).** Official Playwright drives built webview assets through a
   generic static server and an `acquireVsCodeApi` shim. Each extension supplies a small adapter
   (build/prepare commands, asset root, state manifest, selectors, product audit).
2. **Extension-host mode (optional E2E proof).** Official `@vscode/test-electron` (the engine behind
   `@vscode/test-cli`) launches the real extension. The adapter opens the webview through a real
   command; Playwright attaches to the VS Code renderer over the Chromium DevTools endpoint and
   targets the nested `active-frame` webview.

Do **not** make `vscode-extension-tester` or the community `vscode-test-playwright` the core. Keep
`vscode-extension-tester` only as a replaceable driver if the official CDP path breaks. Do not build
a custom VS Code downloader or a custom Electron driver.

The spike proved both modes on this repository and proved reuse with a second, product-free toy
webview. It also found that the current Chrome-CLI harness has a deterministic-completion bug: the
`diff-collapsed` state never publishes its audit under the fixed `--virtual-time-budget`, while the
Playwright runner waits for the page's explicit readiness signal and captures it.

## Evidence index

| Evidence | Artifact | Result |
| --- | --- | --- |
| Toy standalone run, 6 states | `packages/webview-preview/.out/toy/` | 1 clean state passes; 5 deliberate defects each caught by a distinct generic assertion; trace written for the console state |
| ARXML standalone run, all 43 states | `packages/webview-preview/.out/arxml-all-final/` | 43/43 pass, 0 failed, 99.1 s total, 2,281 ms average per state (launch included) |
| ARXML parity, `diff-merge` | `.out/arxml-diff-merge/` vs `.agents/skills/webview-preview/artifacts/diff-merge.*` | same 1400x900 frame; product audit keys, `ready` and `state` match; both audits have `violations: []` |
| Current harness baseline | `.out/baseline-*.log` | `diff-collapsed` fails with "no rendered-geometry audit"; single passing states take 1.7-2.1 s |
| Real extension host | `.out/extension-host/` | VS Code 1.147.0; Playwright reached `active-frame` on the first CDP attempt; screenshots and a 66 KB trace; real control click |
| ExTester comparison | `@redhat-developer/page-objects` 1.26.0 source | frame switch is Selenium outer iframe then `active-frame`; not executed (see [Alternatives](#alternatives)) |
| Community comparison | npm metadata / README | `vscode-test-playwright` is `0.0.1-beta2`, last published 2025-05-31 |

## What the spike built

Throwaway fixture, not a package to publish:

```text
packages/webview-preview/
  src/
    cli.mjs
    adapters/contract.mjs
    assertions/generic.mjs
    modes/standalone.mjs
    runner/{playwright,console,report}.mjs
    webview/{serve,vscodeApiShim}.mjs
  adapters/toy/index.mjs
  adapters/arxml/{build.mjs,index.mjs}
  fixtures/toy/{index.html,app.js,style.css}
  experiments/extensionHost/{run.mjs,suite.cjs,cdpCapture.mjs}
```

The core has no runtime import of `src/`. Only the adapter build step may import extension source.
Verified by searching the core for `src/` imports: the only hit is a usage comment in `cli.mjs`.

## Experiment evidence

### Toy webview (proves reuse, not just ARXML)

Command:

```bash
node packages/webview-preview/src/cli.mjs --adapter adapters/toy/index.mjs --out .out/toy --allow-failures
```

Result: `toy-ok` passes. The five intentional failures are each attributed to the right generic
assertion:

| State | Assertion | Issue |
| --- | --- | --- |
| `toy-overflow` | `no-horizontal-overflow` | document `scrollWidth 2000` > `clientWidth 800` |
| `toy-clipped` | `no-clipped-controls` | button content `133px` clipped by `46px` |
| `toy-overlap` | `no-overlap` | "Save document" overlaps "Run" by `54x30px` |
| `toy-hidden` | `all-visible` | "More" is not visible |
| `toy-console` | `no-console-errors` | `toy state failure`; trace `toy-console.trace.zip` (38 KB) |

This is the second adapter the spike needed: it contains no ARXML import, fixture, selector, or
protocol.

### Standalone result

The ARXML adapter builds static assets first:

```bash
node packages/webview-preview/adapters/arxml/build.mjs
# {"_type":"arxml-preview-build","states":43,"assets":["preview.js","preview.css","monaco.worker.js","assets/"]}
```

Then the generic core consumes only `.out/arxml/`:

```bash
node packages/webview-preview/src/cli.mjs --adapter adapters/arxml/index.mjs --out .out/arxml-all-final --allow-failures
```

Final all-state result: **43/43 states pass, 0 failed, 99.1 s total, 2,281 ms average per state**
(including the one browser launch). `report.json` records every state's assertions, product audit,
artifacts and diagnostics.

The run is deterministic because the adapter declares the page's own completion signal
(`body[data-preview-ready="true"]`), not a wall-clock budget. The page also publishes
`script#preview-audit`; the adapter reads it as the product audit and maps `audit.violations` into
the report.

Two states (`editor-rename-refusal`, `editor-stale-save`) emit a benign console message,
`ECUC editor: ResizeObserver loop completed with undelivered notifications.` The preview page
already filters that class of error in its own page-error path, so the adapter's console assertion
ignores the same pattern. This is exactly the kind of product judgement that belongs in the adapter,
not the core.

Parity for `diff-merge`:

```text
baseline png  1400x900
ours png      1400x900
audit keys    equal
violations    [] and []
state/ready   diff-merge / true in both
generic       no-horizontal-overflow: ok, no-console-errors: ok
```

The PNG bytes are not identical (Chrome's `--screenshot` capture path differs from Playwright's
screenshot path), but the frame size and the product audit agree.

### Current harness baseline

Measured with the current skill, same machine, same Chrome:

| State | Time | Result |
| --- | --- | --- |
| `diff-merge` | 2.06 s | audit present, 0 violations |
| `editor` | 1.73 s | audit present, 0 violations |
| `toolbar-1024` | 1.74 s | audit present, 0 violations |
| `diff-off` | 1.95 s | audit present, 0 violations |
| `diff-collapsed` | 1.95 s | **fails**: `no rendered-geometry audit` |
| all 43 states | 3.2 s | **fails at state 2** (`diff-collapsed`) |

`diff-collapsed` is a real folded-diff state, and the Playwright runner captures it successfully.
The current runner relies on `--virtual-time-budget=10000`; when the page's folding/ResizeObserver
work does not settle inside that budget, the audit script is never emitted and the runner treats it
as a hard failure. The reusable core waits for `body[data-preview-ready="true"]` for up to 30 s and
then reads the audit. This is a capability difference, not a speed tradeoff.

### Real extension host

Setup used the installed VS Code 1.147.0 and the official `@vscode/test-electron` 3.1.0:

```bash
node packages/webview-preview/experiments/extensionHost/run.mjs
```

The extension's activation requires the Rust engine, so the experiment prepared it with
`node scripts/build-engine.mjs --debug`. That is an extension-specific prepare step; a generic tool
must not know about it.

Observed:

| Probe | Result |
| --- | --- |
| Extension loaded | `deviousprophet.vscode-arxml-scope` |
| Webview opened through `vscode-arxml-scope.compareSelected` | `left.arxml <-> right.arxml`, 604 ms after activation |
| Playwright CDP connect | 1 attempt, `http://127.0.0.1:9222` |
| Targets | 1 browser context, 1 workbench page, 3 frames |
| Webview frames | outer `vscode-webview://...` wrapper plus nested `active-frame` |
| DOM readiness | `.monaco-diff-editor` attached in 2.4 s |
| `acquireVsCodeApi` | `function` in the active frame |
| `getState()` from the driver | blocked: `An instance of the VS Code API has already been acquired` |
| Rendered content | 3 `.monaco-editor`, 1 `.monaco-diff-editor`, 11 buttons, 84 rendered rows |
| Accessible selectors | `#diff-view-all`, `#diff-view-diff`, `#diff-merge`, `#diff-swap`, `#diff-next`, ... |
| Real interaction | click `#diff-swap`: `aria-pressed` `false` -> `true`; screenshot shows swapped sides |
| Artifacts | `workbench.png`, `webview.png`, `webview-swapped.png`, `extension-host.trace.zip` (66 KB) |
| Total run | 6.9 s including VS Code start, activation and capture |

Limits found:

- Playwright must target the **nested `active-frame`**, not the outer `vscode-webview://` wrapper.
  The wrapper has the handshake script but no page DOM.
- The external driver cannot acquire the VS Code API again; the page owns the singleton. State
  injection in extension-host mode must go through a real command, real fixture data, or real UI
  interaction. Arbitrary host messages were not attempted in this spike.
- The standalone shim is intentionally permissive because the preview shell deliberately remounts
  pages and calls `resetVsCodeApi()`. The real host rejects the second acquisition. This difference
  is recorded, not hidden: a production shim should stay permissive for preview remounts and rely on
  extension-host mode to catch double-acquire bugs.
- The run opened a real window. Linux CI needs a display server (typically `xvfb`); the standalone
  mode does not.
- The CDP attach is glue code on top of official tools. Playwright documents `connectOverCDP`, but
  VS Code's frame layout and `active-frame` name are not a public compatibility contract.

### Alternatives

**`vscode-extension-tester` (ExTester 8.29.0, Selenium).** Not executed in this spike. Source
inspection of `@redhat-developer/page-objects` 1.26.0 shows the same frame model implemented with
WebDriver: `WebviewMixin.switchToFrame()` finds the outer iframe, calls
`driver.switchTo().frame(view)`, then finds `active-frame` and switches again. It exposes
`findWebElement` only after that switch, downloads VS Code plus the matching ChromeDriver, and
needs a display. It has page-object convenience but no native Playwright trace. This is a viable
fallback driver, not a reason to reject the official stack.

**`vscode-test-playwright` (community, 0.0.1-beta2).** Not executed. It combines Playwright Test
with `@vscode/test-electron` and exposes `evaluateInVSCode` plus the workbench `page`. Its README
does not document webview-frame handling, but Playwright on the workbench can reach the same frames
the spike reached. It is a useful reference and a possible accelerator, but a beta package last
published in May 2025 should not be the core of this tool.

## Comparison matrix

Ratings are for this repository's use case (fast layout loop plus occasional E2E proof).

| Option | Webview access | State injection | Artifacts / diagnostics | Speed on this repo | Platform / display | CI cost | Maintenance |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A. Playwright + standalone built assets** | Preview shell, not the real host | Full: per-state HTML or `postMessage` through the shim | Screenshots, traces, console/page/request capture, report JSON | 43/43 states in 99.1 s, ~2.3 s/state; deterministic | Windows/macOS/Linux; system Chrome/Edge; headless | Low; no VS Code, skip Playwright browser download | Playwright API stable; small shim/server; adapter owns product |
| **B. Playwright + official test-electron/test-cli** | Real VS Code webview; reached `active-frame` | Real command + fixtures; real UI clicks; external API acquire blocked | Workbench and webview screenshots, 66 KB trace, DOM/console | 6.9 s total; 604 ms to open webview | Needs display (xvfb on Linux CI); Electron/VS Code | Medium/high; VS Code install/download, display, version pin | Official test tooling; CDP attach and frame layout are glue, so keep optional |
| **C. vscode-extension-tester / Selenium** | Yes; outer iframe then `active-frame` | Page objects + real UI; extension-side API via tests | WebDriver screenshots; no native trace | Slower: Selenium + ChromeDriver + VS Code | Needs display; downloads VS Code + ChromeDriver | High | Active project (8.29.0, 2026-11-19); locators tied to VS Code DOM |
| **D. vscode-test-playwright** | Playwright on the workbench; same frame access in principle | `evaluateInVSCode` + Playwright UI | Playwright screenshots/traces | Similar to B | Same as B | Medium | Beta (`0.0.1-beta2`, 2025-05-31); no repository URL in npm metadata |
| Current repo harness | Standalone shell via Chrome CLI | Per-state HTML | Screenshot + product audit only | 1.7-2.1 s/state when it works; fails `diff-collapsed` | Chrome/Edge; headless | Low | 2,180-line product audit coupled to ARXML; fixed virtual-time budget |

Capability notes:

- A cannot prove real keyboard/IME, screen-reader output, OS clipboard behavior, packaged VSIX, or
  extension-host protocol timing. It is the right inner loop, not the final E2E proof.
- B can prove the real host, but arbitrary state injection is limited by the extension's commands
  and fixtures. It is the right occasional proof, not the every-edit loop.
- C covers the same ground as B with a heavier, older stack; keep it as a replaceable driver.
- D is a reference implementation of B's integration, not a dependency to adopt now.

## Current preview files: generic versus project-specific

| File | Lines | Classification | Reusable part | Reuse blocker |
| --- | ---: | --- | --- | --- |
| `SKILL.md` | 62 | ARXML usage wrapper | command/output contract shape | ARXML state names and skill path |
| `preview/previewData.ts` | 546 | ARXML fixtures + shell | `previewHtml(state)` static HTML emission | imports `src/host/webviewShell`, `src/core/ecuc/{scanner,renderRows,order,nodeId}`, `src/core/diff/diffModel`, `src/core/copy/copyDirty`; hardcoded ECUC/diff fixtures |
| `preview/previewPage.ts` | 1,756 | ARXML scenario runner | readiness signal and the "apply state, settle, publish audit" shape | imports `src/webview/diffMonaco` and `editorMonaco`; 100+ product interactions |
| `preview/previewAudit.ts` | 2,180 | ARXML audit + private generic geometry | `rectOf`, `isVisible`, `intersects`, `inside`, `overlapLabels`, `outsideLabels`, `clippedLabels` | helpers are private; the exported audit is product-specific (gutter, fold, syscond, sticky, copied markers) |
| `preview/previewStateFields.ts` | 57 | ARXML state protocol | the state manifest shape | every field is a product scenario (`merge`, `swap`, `pan`, `foldLabel`, `detailsRename`, ...) |
| `scripts/previewWebview.mjs` | 144 | mixed server + build | static server and HTML injection pattern | hardcodes skill paths, esbuild entries, `/preview.js`, `/preview.css`, `/monaco.worker.js` |
| `scripts/shotWebview.mjs` | 185 | mixed capture runner | browser detection, screenshot, audit extraction | Chrome CLI only; fixed `#preview-audit`; `--virtual-time-budget`; no trace or console API |

Generic core (belongs in the package):

- browser launch and lifecycle;
- static serving of a built asset root;
- `acquireVsCodeApi` shim and message recording;
- state scheduling, readiness wait and settling;
- screenshots, traces, console/page/request diagnostics;
- geometry predicates (overflow, clipping, overlap, visibility);
- report JSON and exit codes.

Shell concerns (generic but adapter-configured):

- entry page per state;
- CSP nonce;
- state envelope / setup callback;
- product audit reader.

ARXML-specific (stays in the adapter):

- fixtures and `src/` build imports;
- selectors, scenario flags and interaction scripts;
- product invariants (diff gutter, folding, syscond, sticky headers, copied markers, editor dirty
  state).

## Adapter contract

Validated shape (the spike uses ESM JavaScript; the production package should use TypeScript with
the same fields):

```ts
export default definePreview({
  name: 'arxml-scope',
  // Extension-specific preparation and webview build. The core never runs these implicitly.
  prepare: { command: 'npm run engine:build', cwd: '.' },
  build: { command: 'npm run build:webview', cwd: '.' },
  root: 'dist/webview',              // built assets only; core must not import source
  entry: 'diff.html',
  cspNonce: 'preview',               // the shell's script-src nonce
  states: [
    {
      name: 'diff-merge',
      width: 1400,
      height: 900,
      entry: 'diff-merge.html',      // optional per-state built page
      ready: 'body[data-preview-ready="true"]',
      settleMs: 50,
      trace: false,
      setup: async (page, { post }) => {
        await post({ type: 'mergeMode', enabled: true });
      }
    }
  ],
  assertions: [
    noHorizontalOverflow(),
    noClippedControls({ selector: '.toolbar button' }),
    noOverlap({ selector: '.toolbar button' }),
    allVisible({ selector: '.toolbar button', min: 1 }),
    noConsoleErrors({ ignore: [/ResizeObserver loop completed/] })
  ],
  audit: async (page) => readProductAudit(page),
  productAssertions: async ({ audit }) => audit?.violations ?? []
})
```

The minimum a second extension must provide is exactly this: a name, prepare/build commands, a built
asset root, an entry and state list, optional setup callbacks, generic assertion configuration, and
its product audit. The toy adapter is the proof that none of those fields require ARXML knowledge.

Extension-host mode adds only these adapter fields:

```ts
extensionHost: {
  extensionId: 'publisher.extension',
  extensionDevelopmentPath: '.',
  open: async (vscode) => {
    // Adapter-owned: open the webview through a real command with real fixtures.
    await vscode.commands.executeCommand('publisher.extension.openPreview', left, right);
  },
  webview: {
    match: (frameUrl) => frameUrl.includes('extensionId=publisher.extension'),
    frameName: 'active-frame',
    ready: '.my-webview-root'
  }
}
```

The core supplies the launch, CDP attach, frame selection, screenshot/trace capture and report.
The adapter supplies the command and fixtures. A generic tool must not know how to activate a
product or build its engine.

## Package layout and modes

Production layout (the spike's directories map one-to-one; `.mjs` becomes `.ts`):

```text
packages/webview-preview/
  src/
    cli.ts
    config/load.ts
    adapters/contract.ts
    modes/standalone.ts
    modes/extensionHost.ts
    runner/playwright.ts
    runner/console.ts
    runner/screenshots.ts
    runner/report.ts
    webview/serve.ts
    webview/vscodeApiShim.ts
    assertions/generic/{overflow,clipping,overlap,visibility,console}.ts
  fixtures/toy/            # package self-test, not a product fixture
```

Mode 1, standalone:

- adapter prepares/builds assets;
- core serves `root` and injects the shim with the adapter's CSP nonce;
- Playwright launches system Chrome/Edge headless;
- each state gets a fresh context, viewport, optional setup and readiness wait;
- generic and product assertions run; screenshot, trace, console and report are written;
- exit code is non-zero on any failed assertion or product violation.

Mode 2, extension host:

- adapter prepares the extension and built engine;
- `@vscode/test-electron` launches VS Code with a temp workspace, fixtures and a remote-debugging
  port;
- an extension test opens the real webview through the adapter's command;
- the core attaches Playwright over CDP, selects the `active-frame` matching the extension id,
  waits for the ready selector, probes/interacts, screenshots and traces;
- optional, not part of the default loop; a display is required.

## Recommendation

**Adopt A + optional B.** Concretely:

- Make the standalone Playwright core the reusable package and the default preview loop.
- Keep the current `.agents/skills/webview-preview` commands working as a thin wrapper over the new
  CLI until the adapter reaches parity; do not delete the fast loop.
- Add extension-host mode behind an explicit flag, using `@vscode/test-electron` and the adapter's
  `open` hook. Do not make it a required gate.
- Keep the driver replaceable. If CDP attach or `active-frame` breaks, `vscode-extension-tester` is
  the fallback, not a second architecture.
- Do not adopt `vscode-test-playwright` as a dependency; use it as a reference for the integration
  shape.
- Do not add a CI job in this task. If one is added later, run standalone mode on every change and
  extension-host mode only on a schedule or release gate with `xvfb`.

## Follow-up implementation tasks, in order

1. **Create the production package skeleton.** `packages/webview-preview` as TypeScript, with the
   contract, config loader, static server, shim, standalone runner, generic assertions, report and
   exit codes. Self-test against the toy fixture. No `src/` changes.
2. **Add CLI parity and artifact stability.** `--list`, `--state`, `--out`, `--allow-failures`,
   browser override, report schema, trace retention policy. Document the adapter contract beside the
   package.
3. **Port the ARXML adapter.** Keep the existing build entry points as the adapter's `build`
   command, derive states from `previewData.STATES`, read `#preview-audit`, add the console
   allowlist, and compare the new report with the current skill on a fixed state set.
4. **Make the skill a wrapper.** Replace the implementation under
   `.agents/skills/webview-preview` with a one-page usage guide plus a call into the package. Keep
   output paths and state names compatible; keep the old Chrome CLI only as a temporary fallback.
5. **Add extension-host mode.** Use `@vscode/test-electron`, the adapter `prepare`/`open` hooks, the
   `active-frame` selector, workbench/webview screenshots and traces. Pin the VS Code version used
   for evidence; document xvfb for Linux CI.
6. **Add a driver seam and a fallback spike.** Only if step 5 is unstable, evaluate ExTester behind
   the same `driveWebview()` interface. Do not mix Selenium into the core.
7. **Publish and clean up.** Add the package README and docs pointer, delete the throwaway spike
   fixtures, and update the frontend testing spec with the final layer split.

## What not to build

- Do not put ARXML fixtures, selectors, state flags or product audits in the generic core.
- Do not import extension source from the core; only the adapter's build step may.
- Do not make the extension-host mode mandatory for the every-edit loop.
- Do not write a custom VS Code downloader, Electron launcher or CDP framework; official
  `@vscode/test-electron` and Playwright already own those concerns.
- Do not adopt a beta community wrapper as the core.
- Do not replace the current skill before the new adapter passes the same state set.
- Do not add a CI job as part of the implementation without a separate decision.

## Reproduction and cleanup

The throwaway package is self-contained:

```bash
npm --prefix packages/webview-preview install
node packages/webview-preview/adapters/arxml/build.mjs   # after `node esbuild.js` at the repo root
node packages/webview-preview/src/cli.mjs --adapter adapters/arxml/index.mjs --state diff-merge
node packages/webview-preview/experiments/extensionHost/run.mjs   # needs the Rust engine built
```

Artifacts under `.out/` and `packages/webview-preview/.out/` are evidence, not tracked files. The
only tracked additions from this spike are this report, the docs index row, the preview-audit note
under `.trellis/spec/frontend/`, the throwaway package, the `.out/` ignore rule, and the task
record. The current `.agents/skills/webview-preview` implementation is unchanged.
