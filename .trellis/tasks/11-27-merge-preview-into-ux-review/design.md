# Design — merge webview-preview into ux-review

## Target layout

```text
.agents/skills/ux-review/
  SKILL.md                     # single entry point: Preview mode + Host mode
  preview/                     # former webview-preview/preview
    previewData.ts
    previewPage.ts
    previewAudit.ts
    previewStateFields.ts
  scripts/
    preview/                   # former webview-preview/scripts
      shotWebview.mjs
      previewWebview.mjs
    host/                      # ux-review host runner
      run.mjs
      suite.cjs
      driver.mjs
  .cache/                      # generated, ignored
  artifacts/                   # generated, ignored
```

The preview TypeScript imports stay unchanged: `.agents/skills/ux-review/preview` is the same
depth as the old `.agents/skills/ux-review/preview`, so `../../../../src/...` still points
at the repository root.

## Path fixes

- `shotWebview.mjs`: `scriptDir` is now `ux-review/scripts/preview`, so
  `skillDir = path.resolve(scriptDir, '../..')` and artifacts remain `skillDir/artifacts`.
- `previewWebview.mjs`: same `skillDir` fix; `root` becomes
  `path.resolve(scriptDir, '../../../../..')` (preview → scripts → ux-review → skills → .agents →
  repo root). Cache stays `skillDir/.cache`.
- `run.mjs`/`driver.mjs`/`suite.cjs` host paths are already `scripts/host`-relative and do not
  change; `HOST_OUT` still points at task evidence.

## Skill workflow

`ux-review/SKILL.md` has one frontmatter description covering both modes and two sections:

1. **Preview mode** — the old `webview-preview` commands, audit-first rule, output locations,
   workflow and limits. Link `docs/contributor/WEBVIEW_PREVIEW.md` for the 43-state table and
   `DESIGN.md` for the webview design contract.
2. **Host mode** — the current real-host runner, scenarios, capture fidelity, continuity,
   outputs and cleanup.

The `ux-reviewer` agent loads `ux-review` once and selects the mode by task: rendered/visual
state → Preview; commands/keyboard/dialogs/continuity → Host.

## Reference map

| File | Change |
|---|---|
| `AGENTS.md` | Preview skill path and load instruction → `ux-review` Preview mode |
| `DESIGN.md` | Same |
| `.trellis/spec/frontend/preview-audit.md` | Executable-workflow link → `ux-review/SKILL.md` |
| `.trellis/spec/frontend/testing.md`, `component-guidelines.md` | Skill path references |
| `docs/contributor/WEBVIEW_PREVIEW.md` | Commands and skill path |
| `docs/contributor/WEBVIEW_PREVIEW_STACK.md` | Current-harness path |
| `docs/contributor/TEST_PLAN.md` | Skill path references |
| `docs/README.md` | Skill pointer if present |
| `packages/webview-preview/README.md` | Current-skill path |
| `.agents/skills/ux-review/SKILL.md` | Merged workflow |
| `.opencode/agents/ux-reviewer.md` | Load only `ux-review`, use preview mode |
| `.trellis/tasks/11-27-ux-review-user-journeys/**` | Commands/evidence pointers |
| `.agents/skills/ux-review/` | Removed after the move |

Archived task records keep their historical text; they are not live instructions.

## Preview compatibility

The state manifest, audit JSON shape, PNG names, dark-theme limits and `--list` output stay the
same. Only the skill path and artifact directory change. The existing task evidence copies under
`research/evidence/preview/` remain valid.

## Host compatibility

The host runner keeps its current layout under `scripts/host`, so `repoRoot`, `suite.cjs`,
`driver.mjs` and `HOST_OUT` do not change. Only the skill entry point documents it.

## Risks

- A missed reference leaves an agent pointing at a removed skill. Mitigation: a full
  `rg webview-preview` sweep, excluding archived records, then run preview and host smoke tests.
- The preview scripts' depth fix is easy to get wrong. Mitigation: `--list`, one capture and the
  audit JSON before commit.
- Generated `.cache`/`artifacts` could be committed. Mitigation: a skill `.gitignore` and
  `git status` check.

## Rollback

Revert the branch. The old skill is recoverable from the previous commit; no data migration.
