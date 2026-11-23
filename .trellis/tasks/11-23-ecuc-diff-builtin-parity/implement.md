# Implementation plan — VS Code-style ECUC diff body

## Branch strategy

**Do not start any child from `feat/ecuc-vscode-parity`.** Wait until PR #40 merges to `main`, then:

1. `git switch main && git pull`
2. Create the child branch from the latest `main`:
   - `feat/ecuc-diff-body-surface`
   - `feat/ecuc-diff-unchanged-ruler`
   - `feat/ecuc-diff-visual-proof`
3. On the new branch, before task work, add
   `"overrides": { "dompurify": "^3.4.17" }` to `package.json`, refresh
   `package-lock.json`, and include that setup in the branch commit.
4. Run `task.py start <child>` **from that branch**, so the task records the correct branch.
4. Implement, check, commit, and archive the child on its branch.

Body surface and unchanged/ruler can be developed in parallel from `main`; visual proof starts after both are merged (or at least after their final DOM/class contract is stable), because it audits the integrated body. The parent task is the final integration review after all children are archived.

The planning artifacts for this task tree ride with PR #40 so the new branches from `main` have the plans.

## Phase 0 — Baseline and reference

- [ ] Capture the current shipped diff body (`diffMonaco`), the VS Code reference state and the
      exact content fixture before changing classes/decorations.
- [ ] Confirm the shared contract from `design.md` §3 in the current code (`leftLineKeys` /
      `rightLineKeys`, `rowLine`, `hideUnchangedRegions`, merge action).
- [ ] Record the VS Code `^1.125` / Monaco `0.57.0` body measurements: gutter widths, line
      height, font, indentation, whitespace, unchanged-widget geometry, ruler marks and colors.
- [ ] Do not copy a local sample file or VS Code source into the repo; the fixture is synthetic.

## Phase 1 — Body surface child

- [ ] Follow `.trellis/tasks/11-23-ecuc-diff-body-surface/implement.md`.
- [ ] +/− signs and copy-arrow merge margin; line/word highlights; whitespace/indent/density.
- [ ] Keep the current ARXML toolbar and semantic merge/search/selection behavior.
- [ ] Ship the body class/DOM contract the unchanged/ruler child will consume.

## Phase 2 — Unchanged regions and navigation child

- [ ] Follow `.trellis/tasks/11-23-ecuc-diff-unchanged-ruler/implement.md`.
- [ ] Verify and align the native `hideUnchangedRegions` widgets with the VS Code reference; do not add a custom gap renderer.
- [ ] Semantic ruler marks and previous/next hunk navigation.
- [ ] Keep Show all/Show diff, search, collapse and selection behavior.

## Phase 3 — Visual proof child

- [ ] Follow `.trellis/tasks/11-23-ecuc-diff-visual-proof/implement.md`.
- [ ] Check in the VS Code reference capture/spec for the fixed diff state.
- [ ] Audit the real body: gutter, margin, fills, word spans, unchanged widget, ruler, density,
      computed colors.
- [ ] Negative controls: removing the body layer or reverting a class must fail the audit.

## Phase 4 — Parent integration

- [ ] Merge/rebase the children in order, or verify the final branch contains all three.
- [ ] Re-run the body audit against the integrated page.
- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] `npm test --ignore-scripts`
- [ ] `npm run shots:webview`
- [ ] `node esbuild.js --production`
- [ ] `git diff --check`
- [ ] Confirm Dark+ and Light+ screenshots against the checked-in reference; HC smoke.
- [ ] Update the diff spec/docs and changelog only for user-visible outcomes.
- [ ] Archive the children, then this parent.

## Review gates

- [ ] The semantic pre-aligned body remains the source of truth; no native re-alignment or raw
      ARXML text.
- [ ] VS Code-style +/− signs and copy-arrow merge margin are present; no duplicate revert icon
      in merge mode.
- [ ] Line/word highlights and density match the reference roles.
- [ ] Unchanged-region widgets and semantic ruler/navigation work.
- [ ] Current ARXML toolbar, merge, search, collapse and selection remain.
- [ ] Visual-proof audit fails on the old/fake body and passes on the new body.
- [ ] Inline mode, VS Code toolbar and Ignore Whitespace remain out of scope.

## Rollback

- [ ] Revert the body-layer classes/decorations and the reference/audit child; the semantic diff,
      host merge and ARXML data remain unchanged. No protocol or persisted-format migration.
