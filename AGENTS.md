<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

<!-- DESIGN.md:START -->
## Webview design

Webview markup and CSS follow [`DESIGN.md`](DESIGN.md). Read it together with
[`.trellis/spec/frontend/css-guidelines.md`](.trellis/spec/frontend/css-guidelines.md) before changing
the document tree, diff, toolbar, search or sidebar. `npm run design:lint` validates the document.

Layout changes also need eyes: load the `ux-review` skill's Preview mode and run
`.agents/skills/ux-review/scripts/preview/shotWebview.mjs`. It captures every seeded state to
`.agents/skills/ux-review/artifacts/`. The states and the audit checklist are in
[`.agents/skills/ux-review/references/WEBVIEW_PREVIEW.md`](.agents/skills/ux-review/references/WEBVIEW_PREVIEW.md).

<!-- DESIGN.md:END -->

<!-- VERIFICATION:START -->
## Verification

Before handing off: `npm run check-types`, `npm run lint`, `npm test` (includes the
engine vs TypeScript row parity suite in `src/test/parity`), `npm run engine:smoke`
and `npm run rust:test`. `npm run engine:build` stages the engine binary when it is
not built yet.

<!-- VERIFICATION:END -->

<!-- SHIP:START -->
## Shipping

After planning, `/ship` (agent `shipper`, skill `.agents/skills/ship/`) runs the flow to one draft
PR: parallel worktree implementation, integration merges, full gates, `fallow-fix`,
`update-changelog`, `code-review` and `create-pr`. It stops only on a documented blocker; it never
force-pushes, pushes `main`, merges, or suppresses a gate.

<!-- SHIP:END -->
