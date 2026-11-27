# Implementation plan — merge webview-preview into ux-review

## Phase 1 — Move

- [x] Create `.agents/skills/ux-review/preview/` and `.agents/skills/ux-review/scripts/preview/`.
- [x] Move `webview-preview/preview/*` and `webview-preview/scripts/*` into the new directories.
- [x] Move the preview skill's `.gitignore` rules into `ux-review/.gitignore` (`.cache/`,
      `artifacts/`).
- [x] Remove `.agents/skills/webview-preview/` after the move.

## Phase 2 — Paths

- [x] `shotWebview.mjs`: `skillDir = path.resolve(scriptDir, '../..')`; artifacts stay
      `skillDir/artifacts`.
- [x] `previewWebview.mjs`: same `skillDir`; `root = path.resolve(scriptDir, '../../../../..')`;
      cache stays `skillDir/.cache`.
- [x] Update script header comments to the new command paths.
- [x] Keep all `previewData.ts`/`previewPage.ts` imports unchanged and verify they resolve.

## Phase 3 — Single skill workflow

- [x] Merge `webview-preview/SKILL.md` into `ux-review/SKILL.md` as **Preview mode**; keep the
      current host content as **Host mode**.
- [x] Add the preview commands, audit-first workflow, outputs, limits and links to
      `docs/contributor/WEBVIEW_PREVIEW.md` / `DESIGN.md`.
- [x] Update `.opencode/agents/ux-reviewer.md` to load only `ux-review`; preview work uses
      Preview mode, host work uses Host mode.
- [x] Add `.agents/skills/ux-review/.gitignore` for `.cache/` and `artifacts/`.

## Phase 4 — References

- [x] `git grep "webview-preview"` and update every live reference: `AGENTS.md`, `DESIGN.md`,
      `.trellis/spec/frontend/{preview-audit,testing,component-guidelines,css-guidelines,
      component-diff-view,diff-parity,editor-lifecycle,monaco}.md`,
      `docs/contributor/{WEBVIEW_PREVIEW,WEBVIEW_PREVIEW_STACK,TEST_PLAN,DEVELOPMENT}.md`,
      `docs/README.md`, the UX task and the skill itself.
- [x] Leave archived task records as historical text.
- [x] Update the UX task's preview evidence commands to
      `.agents/skills/ux-review/scripts/preview/shotWebview.mjs`.
- [x] Update the task's `design.md`/`implement.md`/`evidence.md`/findings that name the old
      script path.

## Phase 5 — Verify

- [x] `node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --list` → 43 states.
- [x] `--state diff-merge` → fresh PNG + audit JSON, 0 violations, `ready=true`.
- [x] Host `gate` from `.agents/skills/ux-review/scripts/host/run.mjs` passes.
- [x] `git grep "webview-preview"` has no live skill path references outside the separate
      `packages/webview-preview` spike package and archived history.
- [x] `git status` has no `.cache`/`artifacts`; no `src/**` diff.
- [x] Spot-check docs links: 0 missing.

## Phase 6 — Commit

- [ ] Commit `refactor(skill): merge webview-preview into ux-review`.
- [ ] Commit the agent/docs/task reference updates if separate.
- [ ] Push the branch.

## Rollback

Revert the branch; the old skill is in git history.
