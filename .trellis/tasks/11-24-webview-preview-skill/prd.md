# Package the webview preview harness as an AI skill

## Goal

Make `.agents/skills/webview-preview/` the **only source** of the webview preview/capture harness. The skill contains the runner scripts, the preview page, fixtures, audit and state fields, plus `SKILL.md`. No preview/capture code remains in `src/test/preview/` or `scripts/`.

The skill is executable by an AI agent. The runners are Node ESM; the preview page remains TypeScript/JavaScript and is bundled by esbuild. No `tsconfig.json` is added and no harness unit test is required: the skill’s own `--list` / capture run is the verification.

## Requirements

- **Single home**
  - `.agents/skills/webview-preview/SKILL.md`.
  - `.agents/skills/webview-preview/scripts/previewWebview.mjs` and `shotWebview.mjs`.
  - `.agents/skills/webview-preview/preview/{previewData,previewPage,previewAudit,previewStateFields}.ts`.
  - Delete `scripts/previewWebview.mjs`, `scripts/shotWebview.mjs` and the `src/test/preview/` directory after the move.
  - No duplicate preview source elsewhere.
- **Runnable from the skill**
  - Resolve the repo root from the script/file location, not `process.cwd()`.
  - Bundle the skill’s `preview/` entry points with esbuild; do not typecheck them.
  - Write the generated browser bundle under the skill (e.g. `.cache/`).
  - Write captures and audits under the skill (e.g. `artifacts/`), or document one fixed output root that is owned by the skill.
  - Preserve states, flags (`--state`, `--list`, `--port`), audit behavior and process-tree cleanup.
- **Skill contract**
  - `SKILL.md` frontmatter and triggers for preview/screenshot/visual checks.
  - Agent workflow: list → capture → read audit → inspect PNG → recapture; full set for layout changes.
  - Output paths, `CHROME_PATH`, cleanup and limits.
  - Explicitly state that preview source lives only in this skill.
- **Docs and commands**
  - Update `package.json` `preview:webview` / `shots:webview` to the skill scripts.
  - Update `docs/WEBVIEW_PREVIEW.md`, `docs/README.md` and code comments to the skill paths; keep the human doc as a pointer to the skill.
  - No stale `src/test/preview` or old `scripts/` references.
- **Verification**
  - No `tsconfig` for the skill and no harness unit test.
  - `node .agents/skills/webview-preview/scripts/shotWebview.mjs --list` returns the states.
  - One state capture writes a PNG and audit, and the audit is clean.
  - Full suite/lint/fallow/production gates still pass for the extension code.

## Non-goals

- Typechecking or linting the skill’s preview TypeScript.
- Adding a harness test under `src/test`.
- Changing fixtures, audit rules, state names or rendering.
- Adding a browser dependency.
- Keeping any preview code in `src/test/preview` or `scripts/`.

## Acceptance criteria

- [x] The skill contains the only copies of the runners, page, fixtures, audit and state fields.
- [x] `src/test/preview/` and the two old runner scripts are gone; no preview source remains outside the skill.
- [x] The skill runs from any cwd, bundles its own `preview/` entry points, and writes only to its own cache/artifacts paths.
- [x] `--list`, `--state` and `--port` work through `npm run preview:webview` / `npm run shots:webview`.
- [x] `SKILL.md` documents the agent workflow, outputs, cleanup and limits.
- [x] `docs/WEBVIEW_PREVIEW.md` / `docs/README.md` point to the skill and contain no stale paths.
- [x] No tsconfig and no harness unit test are added.
- [x] `--list`, one state capture, full extension suite, lint and fallow pass.
