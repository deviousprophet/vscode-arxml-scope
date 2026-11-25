# Implementation plan — docs/ rework

## Branch gate

- [ ] Start from `main` after the gutter, preview-skill and parity-harness branches
      merge. Those branches edit `docs/WEBVIEW_PREVIEW.md`, `docs/TEST_PLAN.md`,
      `docs/vscode-diff-parity.md` and the preview skill.
- [ ] Create `feat/docs-information-architecture` in its own worktree.
- [ ] Copy this task directory there; keep the plan.
- [ ] `task.py start 11-24-docs-information-architecture` only after the artifacts are
      reviewed.

## Phase 0 — Inventory and link graph

- [ ] List every file under `docs/`, root `DESIGN.md`, and the spec/skill pages they
      reference.
- [ ] For each page, record audience, purpose, canonical commands and duplicate content.
- [ ] Build the link graph:
      `rg -n "docs/|WEBVIEW_PREVIEW|TEST_PLAN|vscode-diff-parity|ECUC_EDITOR|DIFF.md|MERGE.md"`.
- [ ] Read `research/docs-audit.md` and reconcile its evidence with the current branch.
- [ ] Find stale paths:
      `rg -n "src/test/preview|scripts/parity|npm run shots:webview|npm run preview:webview" docs`.
- [ ] Verify encoding with a UTF-8 scan (no U+FFFD). Do not treat console `�` as file
      damage; the research audit found valid UTF-8.
- [ ] Decide the final folder names (`docs/user`, `docs/contributor` or a flat indexed
      layout) and write them in the task notes.

## Phase 1 — Rewrite the index

- [ ] Rewrite `docs/README.md` from scratch with two audience tables:
      **For users** and **For contributors**.
- [ ] Add an **Agent specs** line pointing to `.trellis/spec/frontend/index.md` and the
      relevant skill, not a copy of their instructions.
- [ ] Confirm the files are valid UTF-8 and all relative links resolve.
- [ ] Link root `DESIGN.md`, examples, changelog and root README.
- [ ] Every docs page must appear exactly once in the index.

## Phase 2 — User guides

- [ ] Move `ECUC_EDITOR.md`, `DIFF.md`, `MERGE.md` to the chosen user path.
- [ ] Move the retired DOM-renderer appendix from `ECUC_EDITOR.md` to
      `docs/contributor/legacy-dom-renderer.md`, or delete it with owner approval; keep
      the current Monaco workflow as the user page.
- [ ] Remove build/test/agent commands and source-path detail from user pages; keep
      “what the user sees and does”.
- [ ] Correct the stale “Document is read-only” limitation.
- [ ] Update `MERGE.md` to the built-in hover gutter copy actions (already changed on the
      gutter branch; verify) and add a back-link to `DIFF.md`.
- [ ] Split the semantic scoring/budget/benchmark detail out of `DIFF.md` into
      `.trellis/spec/frontend/diff-matching.md`; keep user-visible change classes.
- [ ] Correct the DIFF read-only/custom-gutter limitations and link the Monaco/spec page.

## Phase 3 — Contributor pages

- [ ] Move `ENGINE.md`, `TEST_PLAN.md`, `WEBVIEW_PREVIEW.md` to the chosen contributor
      path.
- [ ] Add `DEVELOPMENT.md` if it reduces duplication: setup, build, engine, test, preview
      links with one command block each.
- [ ] Trim `ENGINE.md` to operator/contributor behavior; link protocol details to
      `rust/README.md` and code-level contracts to the spec.
- [ ] Add `ENGINE.md` to the contributor index; it is currently orphaned.
- [ ] Split `TEST_PLAN.md`:
  - [ ] human regression layers, gates, fixtures and known gaps stay;
  - [ ] agent execution rules and code-level “must/must not” checks move to
        `.trellis/spec/frontend/testing.md`;
  - [ ] one canonical command list, linked from both;
  - [ ] correct the stale “merge is planned”, “restart/backoff is not implemented” and
        “diff is read-only” rows.
- [ ] Trim `WEBVIEW_PREVIEW.md`:
  - [ ] keep the contributor commands, state table, outputs, cleanup and limits;
  - [ ] move audit invariants to `.trellis/spec/frontend/preview-audit.md`;
  - [ ] link the `webview-preview` skill for the agent workflow;
  - [ ] no duplicated command block between the skill and the docs page.

## Phase 4 — Spec extraction

- [ ] `git mv docs/vscode-diff-parity.md .trellis/spec/frontend/diff-parity.md`.
- [ ] Add `.trellis/spec/frontend/monaco.md`: synthetic document, find bridge, diff
      editor ownership, built-in gutter/sash and the intentional folding deviation.
- [ ] Add `.trellis/spec/frontend/diff-matching.md` if the scoring/budget detail leaves
      `docs/DIFF.md`.
- [ ] Add `.trellis/spec/frontend/preview-audit.md` with the invariants and the states
      that enforce them.
- [ ] Extend `.trellis/spec/frontend/testing.md` with the agent gates, parity rules and
      preview-full-set rule.
- [ ] Add `.trellis/spec/guides/documentation-architecture-guide.md` with the
      audience/canonical-home rules and link it from the guides index.
- [ ] Update `.trellis/spec/frontend/index.md` and any component index links.
- [ ] Update the top-level `AGENTS.md` only if it names a moved path.
- [ ] Keep `docs/` pages as short links to these spec pages.

## Phase 5 — Links and cleanup

- [ ] `rg` for every old path:
      `docs/(ECUC_EDITOR|DIFF|MERGE|ENGINE|TEST_PLAN|WEBVIEW_PREVIEW|vscode-diff-parity)`.
- [ ] Resolve every relative Markdown link with a one-off Node/PowerShell check.
- [ ] Delete empty folders.
- [ ] Add short redirect stubs only for paths with likely external links; otherwise
      remove them.
- [ ] Confirm valid UTF-8 with no replacement characters in every changed Markdown file.
- [ ] Confirm no content was deleted without a new canonical home.

## Phase 6 — Verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `node .agents/skills/webview-preview/scripts/shotWebview.mjs --list` (the docs
      still point at a working skill)
- [ ] Link check over all changed Markdown files.
- [ ] `git diff --check`
- [ ] Review the final tree: `Get-ChildItem docs -Recurse` / `find docs -type f`.

## Review gates

- [ ] Every `docs/` page is user-facing or contributor-facing, never agent-only.
- [ ] Every code-level contract is in `.trellis/spec` or the skill, with a docs link.
- [ ] `docs/README.md` indexes every page with audience and purpose.
- [ ] No replacement characters, stale command, removed path or broken relative link.
- [ ] No duplicated command/audit block between docs, spec and skill.
- [ ] No product behavior changed.

## Rollback

- [ ] Revert the docs task commits; restore moved pages and old links. No runtime or
      persisted-data migration.
