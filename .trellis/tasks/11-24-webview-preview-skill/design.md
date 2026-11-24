# Design — single-home webview preview skill

## 1. Layout

```text
.agents/skills/webview-preview/
  SKILL.md
  .gitignore                     ignores .cache/ and artifacts/
  scripts/
    previewWebview.mjs           esbuild page bundler + local HTTP server
    shotWebview.mjs              headless capture + audit runner
  preview/
    previewData.ts               fixtures, states, shell payload
    previewPage.ts               real page gestures + audit publishing
    previewAudit.ts              DOM/geometry audit
    previewStateFields.ts        state field types
  .cache/                        generated preview.js / assets (ignored)
  artifacts/                     PNGs + audit JSON (ignored)
```

`src/test/preview/` and the old `scripts/` runners are removed. No preview/capture source remains outside the skill.

## 2. Runtime and paths

- The runners stay Node ESM.
- `scriptDir = path.dirname(fileURLToPath(import.meta.url))`
- `skillDir = path.resolve(scriptDir, '..')`
- `repoRoot = path.resolve(scriptDir, '../../../..')` (scripts → skill → skills → .agents → repo)
- `previewDir = path.join(skillDir, '.cache')`
- `captureDir = path.join(skillDir, 'artifacts')`
- `previewWebview.mjs` bundles:
  - `<skillDir>/preview/previewData.ts` for Node (temp CJS);
  - `<skillDir>/preview/previewPage.ts` for the browser into `<skillDir>/.cache/preview.js`.
- `shotWebview.mjs` imports the colocated server and writes captures/audits under `<skillDir>/artifacts/`.
- Preserve `startPreview`, flags, state list, process-tree kill, signal/error cleanup, temporary profile removal and the free-port behavior.

## 3. Moved TypeScript imports

The preview files move from `src/test/preview` to `.agents/skills/webview-preview/preview`. Their relative production imports change from `../../...` to `../../../../src/...`:

- `previewData.ts`: `webviewShell`, `core/ecuc`, `core/diff`, `webviewProtocol`.
- `previewPage.ts`: production page entries, audit, state fields.
- `previewAudit.ts`: any production types/utilities it references.
- `previewStateFields.ts`: no production imports.

No `tsconfig.json` is added. Esbuild strips TypeScript. `npm run check-types` and `eslint src` intentionally do not cover the skill; this is accepted by the user. The executable `--list`/capture run is the check.

## 4. Skill contract

`SKILL.md`:

```yaml
---
name: webview-preview
description: "Render and capture the real ARXML Scope webview pages in headless Chrome/Edge and inspect the seeded PNGs and geometry audits. Use when asked to preview, screenshot, visually check or debug the webview/editor/diff layout."
---
```

Body:

- **When to use** — layout, CSS, toolbar, editor/diff visual changes.
- **Workflow** — list states, capture one/all, read audit first, inspect PNG, fix/recapture.
- **Commands** — npm aliases and direct skill paths.
- **Outputs** — `artifacts/<state>.png`, `<state>.audit.json`; `.cache/` is temporary.
- **Cleanup** — runner kills browser tree/server/profile on every exit.
- **Limits** — seeded production shell, dark preview, Chrome/Edge, no VS Code reference capture.
- **Single home** — all preview source is inside this skill; never add a second copy.

## 5. Docs and commands

- `package.json`:
  - `"preview:webview": "node .agents/skills/webview-preview/scripts/previewWebview.mjs"`
  - `"shots:webview": "node .agents/skills/webview-preview/scripts/shotWebview.mjs"`
- `docs/WEBVIEW_PREVIEW.md`: commands, architecture, how-it-works, adding a state, output paths and AI skill section updated to the skill.
- `docs/README.md`: link description mentions the AI skill.
- Comments in the moved files and any other references updated; no stale `src/test/preview` or `scripts/...` runner paths.

## 6. Verification

No tsconfig and no harness test.

- `node .agents/skills/webview-preview/scripts/shotWebview.mjs --list`
- one `--state` capture; read the audit and inspect the PNG
- full `npm run shots:webview` for layout changes
- `npm run check-types`, `npm run lint`, `npm test --ignore-scripts`, fallow, production bundle, `git diff --check`
- grep the repo for `src/test/preview`, `scripts/previewWebview.mjs`, `scripts/shotWebview.mjs`, `dist/preview` and fix stale hits (except historical/task docs if intentionally preserved).

## 7. Risks and rollback

- **Import paths**: moving TS changes relative imports to production modules; esbuild will fail loudly. Run a capture to validate.
- **Generated output**: the old `dist/preview` must not remain the served path; use the skill `.cache/`.
- **Docs drift**: grep for old paths; docs are the main discoverability surface.
- **No typecheck**: accepted; a runtime bundle/capture is the gate.
- **Rollback**: move `preview/` back to `src/test/preview`, runners back to `scripts/`, restore package/docs paths; remove the skill.
