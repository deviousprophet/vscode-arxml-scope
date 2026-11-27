# Fix UX review findings

## Goal

Close the user-facing defects from the fresh UX review. The review report and evidence are in
`.trellis/tasks/11-27-ux-review-from-scratch/research/`; the findings are the source of truth.

## Task map

| Child | Findings | Priority |
|---|---|---|
| `11-27-fix-diff-save-compare` | UX-06, UX-07 | P1 |
| `11-27-fix-editor-refusal-recovery` | UX-01, UX-02 | P1 |
| `11-27-polish-ux-chrome-errors` | UX-03, UX-04, UX-05, UX-08, UX-09 | P2 |

Each child is independently plannable, implementable, testable and archivable. The parent owns
the shared source requirement, the integration review and the final verification.

## Shared requirements

- Use the review's evidence paths and repro steps; do not invent a different defect.
- Preserve the copy/merge data model and the existing user-facing contracts unless the finding is
  about that contract.
- Add a regression test at the closest layer: core unit test for pure logic, host/extension test
  for command or provider behavior, preview audit for layout.
- Run `npm run check-types`, `npm run lint`, `npm test`, `npm run engine:smoke`, `npm run rust:test`
  for children that touch source or build output.
- Keep the consolidated `ux-review` skill/agent unchanged unless a fix reveals a review-blocking
  harness bug; record that separately.
- No new `docs/` preview pages; preview docs stay in the skill references.

## Cross-child acceptance

- [ ] Every child finding has a regression test or a recorded preview/host proof.
- [ ] The combined branch keeps the primary edit, diff, merge, index and engine-first-run loops
      working.
- [ ] No unrelated refactor or UX redesign rides along with a fix.
- [ ] The review report's evidence is not deleted or rewritten to match the fixes.
- [ ] Final integration review compares each finding to the actual diff.

## Non-goals

- Re-running the whole UX review.
- Fixing defects not listed in the three children.
- Changing the extension's feature set.
