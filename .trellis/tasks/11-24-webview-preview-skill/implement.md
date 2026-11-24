# Implementation plan — single-home webview preview skill

## Branch gate

- [x] Worktree/branch `feat/webview-preview-skill` created from `main`.
- [x] Task copied into the worktree.
- [x] `task.py start 11-24-webview-preview-skill` after these revised artifacts are reviewed.
- [x] Do not touch the in-progress `feat/ecuc-diff-vscode-gutter` worktree.

## Phase 0 — Baseline

- [x] Run the current `npm run shots:webview -- --list` and one state capture; record the state names, output paths and cleanup behavior.
- [x] Inventory all references to `src/test/preview`, `scripts/previewWebview.mjs`, `scripts/shotWebview.mjs` and `dist/preview`.
- [x] Record the exact relative imports in the four preview TypeScript files.

## Phase 1 — Move all preview source

- [x] Create `.agents/skills/webview-preview/{scripts,preview}`.
- [x] `git mv scripts/previewWebview.mjs .agents/skills/webview-preview/scripts/`.
- [x] `git mv scripts/shotWebview.mjs .agents/skills/webview-preview/scripts/`.
- [x] `git mv src/test/preview/previewData.ts .agents/skills/webview-preview/preview/`.
- [x] `git mv src/test/preview/previewPage.ts .agents/skills/webview-preview/preview/`.
- [x] `git mv src/test/preview/previewAudit.ts .agents/skills/webview-preview/preview/`.
- [x] `git mv src/test/preview/previewStateFields.ts .agents/skills/webview-preview/preview/`.
- [x] Remove the now-empty `src/test/preview` directory.
- [x] Update relative imports in the moved preview files from `../../...` to `../../../../src/...` where production modules are imported.
- [x] Update runner paths:
  - [x] resolve `repoRoot` from `import.meta.url` (four levels up);
  - [x] bundle `<skillDir>/preview/previewData.ts` and `previewPage.ts`;
  - [x] write the browser bundle to `<skillDir>/.cache`;
  - [x] write captures/audits to `<skillDir>/artifacts`;
  - [x] keep `startPreview`, flags, audit behavior and process-tree cleanup.
- [x] Add `.agents/skills/webview-preview/.gitignore` for `.cache/` and `artifacts/`.

## Phase 2 — Skill and docs

- [x] Add `.agents/skills/webview-preview/SKILL.md` with valid frontmatter, triggers, single-home statement, workflow, commands, outputs, cleanup and limits.
- [x] Update `package.json`:
  - [x] `preview:webview` → skill script;
  - [x] `shots:webview` → skill script.
- [x] Update `docs/WEBVIEW_PREVIEW.md`:
  - [x] commands/direct paths and architecture;
  - [x] how-it-works paths;
  - [x] adding-a-state path to skill `previewData.ts`;
  - [x] output paths and AI skill section;
  - [x] no stale `src/test/preview`/old runner paths.
- [x] Update `docs/README.md` link description.
- [x] Update comments in the moved files and `AGENTS.md` if it names old paths.
- [x] Remove or redirect any `dist/preview` assumptions; the skill `.cache` is the only served preview bundle.

## Phase 3 — Verification without a harness test

- [x] `node .agents/skills/webview-preview/scripts/shotWebview.mjs --list` from the repo root and from another cwd; assert the same states.
- [x] `npm run shots:webview -- --state <one layout state>`; read the audit, inspect the PNG.
- [x] `npm run preview:webview` direct path smoke; confirm the server serves the skill page and stops cleanly.
- [x] Confirm no browser, server or temp profile remains.
- [x] Grep the repo for `src/test/preview`, `scripts/previewWebview.mjs`, `scripts/shotWebview.mjs`, `dist/preview`; fix stale live references.
- [x] `npm run check-types`
- [x] `npm run lint`
- [x] `npm test --ignore-scripts`
- [x] `npm run shots:webview` full seeded set
- [x] `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs` -> GREEN
- [x] `node esbuild.js --production`
- [x] `git diff --check`

No `tsconfig.json` and no harness unit test are added; the executable `--list` + capture run is the skill check.

## Review gates

- [x] The skill is the only source of preview/capture code.
- [x] `src/test/preview` and old runner scripts are gone.
- [x] The skill runs from any cwd and writes only to its own `.cache`/`artifacts`.
- [x] `package.json` and docs point only to the skill.
- [x] `--list`, one capture and the full seeded set pass.
- [x] Extension suite/lint/fallow/production remain green.

## Rollback

- [x] Move `preview/` back to `src/test/preview`, the two runners back to `scripts/`, restore `package.json`/docs/output paths and delete the skill.
