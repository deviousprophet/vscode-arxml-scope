# Merge webview-preview into ux-review

## Goal

One reusable UX-review skill with two modes: seeded preview captures and real VS Code host
journeys. Remove the separate `ux-review` Preview mode without breaking its commands, docs or
references.

## Requirements

1. Move the seeded preview harness (preview sources, scripts, skill workflow) under
   `.agents/skills/ux-review/`.
2. Keep `ux-review` as the single skill the `ux-reviewer` agent loads, with a **Preview mode**
   and a **Host mode**.
3. Fix every path that depends on the old skill depth: `shotWebview.mjs`,
   `previewWebview.mjs`, artifact/cache directories and the repo-root resolution.
4. Update every current repository reference: `AGENTS.md`, `DESIGN.md`, `.trellis/spec/`,
   `docs/`, `TEST_PLAN.md`, the spike report, the package README and the UX task.
5. Preserve the preview contract: `--list` returns 43 states, one-state capture writes PNG +
   audit JSON, the audit-first workflow and the dark-theme/limit notes.
6. Preserve the host contract: `run.mjs` gate and capture-fidelity scenarios, `HOST_OUT`, temp
   workspace/profile cleanup and engine restore.
7. Remove the old skill directory; do not commit generated `.cache/` or `artifacts/`.
8. No production `src/**` change and no behavior change to the extension.

## Acceptance criteria

- [ ] `node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --list` lists 43 states.
- [ ] `--state diff-merge` writes a fresh PNG + audit JSON with 0 violations.
- [ ] The host `gate` scenario passes from `.agents/skills/ux-review/scripts/host/run.mjs`.
- [ ] `ux-reviewer` loads only `ux-review` and still covers preview + host.
- [ ] No live `webview-preview` path remains outside archived history.
- [ ] Working tree has no generated preview artifacts; no `src/**` diff.

## Constraints

- Keep the 43-state table and limits in
  `.agents/skills/ux-review/references/WEBVIEW_PREVIEW.md`; do not keep a `docs/contributor`
  preview page.
- Keep the host runner's ARXML-specific commands/selectors isolated in `scripts/host/`.
- The old skill remains recoverable from git history; do not keep a duplicate directory.

## Non-goals

- Changing preview states, audits, CSS or the extension.
- Making the preview harness generic across extensions.
- Reworking the UX review findings.
