# Rework the docs/ information architecture

## Goal

Make `docs/` a clear library for **users and contributors**, and make `.trellis/spec/` the
canonical home for **AI-agent implementation contracts**. Remove duplication, stale
commands, dead links and encoding damage; split oversized guides so each page has one
audience and one job.

`docs/` is not an agent scratchpad. Agent-only execution rules, code-level parity
manifests and audit invariants belong in `.trellis/spec/` or the relevant skill, linked
from the contributor docs.

## Current inventory

| File | Current audience | Problem |
|---|---|---|
| `docs/README.md` | mixed | Index mixes user guides with agent-only skill/test docs; links the spec with an absolute GitHub URL |
| `docs/ECUC_EDITOR.md` | user + retired renderer | Current Monaco workflow mixed with an explicitly retired DOM-renderer appendix; one limitation still says the Document is read-only |
| `docs/DIFF.md` | user + algorithm | Usage mixed with semantic scoring/budget detail; limitation still describes the diff as read-only |
| `docs/MERGE.md` | user | Updated to the gutter actions, but no back-link to the diff guide |
| `docs/ENGINE.md` | contributor/operator | Orphaned (not linked from the docs index); architecture/operator detail overlaps agent specs |
| `docs/TEST_PLAN.md` | contributor + agent | 22 KB; mixes human regression plan with agent execution gates; stale merge, restart/backoff and read-only rows |
| `docs/WEBVIEW_PREVIEW.md` | contributor + agent | 22 KB; duplicates the `webview-preview` skill workflow and audit rules |
| `docs/vscode-diff-parity.md` | contributor + agent | Code-level hashes/adapters; belongs with agent implementation contracts |
| root `DESIGN.md` | user/contributor | Design system; indexed from docs but lives at root and is the `design:lint` target |
| `.trellis/spec/frontend/*` | agent | Has testing/component/lifecycle specs; no Monaco page, no diff-matching page, stale preview paths |

## Requirements

- **Audience split**
  - User guides: how to open, edit, compare, merge and understand the product. No build
    commands, source paths, audit invariants or agent workflows.
  - Contributor guides: setup, build, test, engine, preview commands and limitations.
  - Agent specs: code-level contracts, audit invariants, parity manifests, protocol
    details and “must/must not” rules.
- **One canonical source per fact**
  - The `webview-preview` `SKILL.md` owns the executable agent workflow.
  - `.trellis/spec/frontend/` owns the code-level diff/preview/test contracts.
  - `docs/` links to those pages instead of copying their command blocks and invariants.
- **Organize**
  - Introduce an audience-based structure (for example `docs/user/` and
    `docs/contributor/`) or an equally clear flat index; do not leave a mixed bag.
  - Every file has a one-line purpose and audience in `docs/README.md`.
  - Split `TEST_PLAN.md`: human regression plan stays under `docs/`; agent gates move to
    the testing spec.
  - Trim `WEBVIEW_PREVIEW.md` to a contributor pointer + commands + limits; move audit
    invariants to the preview spec and keep the skill as the workflow.
  - Move `vscode-diff-parity.md` to `.trellis/spec/frontend/` and link it from the
    contributor diff page.
- **Clean**
  - Confirm all docs/spec files are valid UTF-8 with no replacement characters; apparent
    mojibake in terminal output is a console-decoding artifact, not a file defect.
  - Fix stale command names, dead relative links and references to removed files
    (`src/test/preview`, `scripts/parity*.mjs`, `npm run shots:webview`, etc.).
  - Refresh the stale claims: the diff is not read-only, merge shipped, engine
    restart/backoff is implemented, and the ECUC editor is Monaco.
  - Do not keep a page “for history”; git history is the archive.
  - Keep a short redirect/stub only when an external link is likely to break.
- **Index**
  - Update `docs/README.md`, `.trellis/spec/frontend/index.md`,
    `.trellis/spec/guides/index.md` and the root README links.
  - Add the new spec pages to the appropriate index: `frontend/monaco.md`,
    `frontend/diff-matching.md` (if the algorithm detail moves) and
    `guides/documentation-architecture-guide.md`.
- **Do not change product behavior**
  - This is a documentation/spec move, not a code refactor. Any code change must be a
    link/test fixture required by the docs move and called out separately.

## Research

`.trellis/tasks/11-24-docs-information-architecture/research/docs-audit.md` holds the
per-file audience classification, inbound/outbound link graph, stale-content table,
duplication map and proposed target tree. The plan must use that evidence and resolve its
open questions during implementation.

The audit was produced from the preview-skill worktree. Re-check every command and path
against the merged target branch: the preview source now lives only under
`.agents/skills/webview-preview/`, and the `preview:webview` / `shots:webview`
`package.json` aliases are gone. Do not reintroduce them while cross-linking docs.

## Non-goals

- Rewriting the user guides from scratch.
- Changing the extension behavior, engine protocol or test suite.
- Moving root `DESIGN.md` or `AGENTS.md`.
- Adding a documentation site generator.
- Keeping duplicate copies “just in case”.

## Acceptance criteria

- [ ] `docs/README.md` lists every docs/ page with audience and purpose, and is valid
      UTF-8 with no replacement characters.
- [ ] User guides contain no build/test/agent commands; contributor guides do.
- [ ] `TEST_PLAN.md` is split between the human plan and the agent testing spec, with the
      stale read-only/merge/restart rows corrected.
- [ ] `WEBVIEW_PREVIEW.md` no longer duplicates the skill workflow/audit rules.
- [ ] `vscode-diff-parity.md` lives under `.trellis/spec/frontend/` and is linked from
      the contributor diff docs.
- [ ] The retired DOM-renderer appendix is either clearly labelled and linked from the
      contributor docs or removed with owner approval; it is not presented as current.
- [ ] Every moved or split page is present in its new canonical home; no content is lost.
- [ ] `.trellis/spec/frontend/index.md` and `.trellis/spec/guides/index.md` index every
      new spec page.
- [ ] All relative links resolve; `rg` finds no stale paths or removed commands.
- [ ] `npm run check-types`, `npm run lint` and `npm test` still pass (docs must not break
      the build).
- [ ] `git diff --check` is clean.
