# Implementation plan — VS Code-style ECUC diff body

## Branch strategy

**User decision: finish all remaining diff-body tasks on one branch.**

- Body surface, unchanged/ruler and visual proof all land on `feat/ecuc-diff-body-surface`.
- Do not create `feat/ecuc-diff-unchanged-ruler` or `feat/ecuc-diff-visual-proof`.
- The `dompurify` override and the full task tree already live on that branch.
- Run `task.py start <child>` on the same branch as each child begins.
- Visual proof runs after unchanged/ruler is complete on that branch, so it audits the integrated body.
- The parent task is the final integration review after all children are archived.
- PR #41 remains the single review branch for the whole task tree.

## Phase 0 — Baseline and reference

- [ ] Capture the current shipped diff body (`diffMonaco`), the VS Code reference state and the
      exact content fixture before changing classes/decorations.
- [ ] Confirm the shared contract from `design.md` §3 in the current code (`leftLineKeys` /
      `rightLineKeys`, `rowLine`, `hideUnchangedRegions`, merge action).
- [ ] Record the VS Code `^1.125` / Monaco `0.57.0` body measurements: gutter widths, line
      height, font, indentation, whitespace, unchanged-widget geometry, native diff-overview
      geometry and colors.
- [ ] Do not copy a local sample file or VS Code source into the repo; the fixture is synthetic.

## Phase 1 — Body surface child

- [ ] Follow `.trellis/tasks/11-23-ecuc-diff-body-surface/implement.md`.
- [ ] Native +/− signs, fills, word spans, overview ruler; built-in margin right arrow plus one
      copy-left arrow; whitespace/indent/density.
- [ ] Keep the current ARXML toolbar and semantic merge/search/navigation behavior.
- [ ] Ship the body class/DOM contract the unchanged/ruler child will consume.

## Phase 2 — Unchanged regions and navigation child

- [ ] Follow `.trellis/tasks/11-23-ecuc-diff-unchanged-ruler/implement.md`.
- [ ] Verify and align the native `hideUnchangedRegions` widgets with the VS Code reference; do not add a custom gap renderer.
- [ ] Keep Monaco's native overview ruler; semantic previous/next hunk navigation.
- [ ] Keep Show all/Show diff, search, collapse and navigation behavior.

## Phase 3 — Visual proof child

- [ ] Follow `.trellis/tasks/11-23-ecuc-diff-visual-proof/implement.md`.
- [ ] Check in the VS Code reference capture/spec for the fixed diff state.
- [ ] Audit the real body: gutter, margin arrows, fills, word spans, unchanged widget, native
      overview ruler, density, computed colors.
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

- [ ] The per-side synthetic ECUC body remains the semantic source of truth; no native raw
      ARXML text.
- [ ] Native +/− signs and fills are present; the built-in margin right arrow and one copy-left
      arrow post the host copy; no custom overlay or duplicate revert.
- [ ] Line/word highlights and density match the reference roles.
- [ ] Unchanged-region widgets, the native overview ruler and semantic navigation work.
- [ ] Current ARXML toolbar, merge, search, collapse and navigation remain.
- [ ] Visual-proof audit fails on the old/fake body and passes on the new body.
- [ ] Inline mode, VS Code toolbar and Ignore Whitespace remain out of scope.

## Rollback

- [ ] Revert the body-layer classes/decorations and the reference/audit child; the semantic diff,
      host merge and ARXML data remain unchanged. No protocol or persisted-format migration.
