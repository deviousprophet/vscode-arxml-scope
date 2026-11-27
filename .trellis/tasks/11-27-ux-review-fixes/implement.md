# Implementation plan — fix UX review findings

## Phase 1 — Child planning

- [x] Create the three child tasks with the review dispositions.
- [ ] Finish each child's PRD/design/implement before starting it.
- [ ] Curate each child's `implement.jsonl` / `check.jsonl`.

## Phase 2 — Child delivery (ordered)

1. `11-27-fix-diff-save-compare` — UX-06, UX-07.
2. `11-27-fix-editor-refusal-recovery` — UX-01, UX-02.
3. `11-27-fix-light-theme-contrast` — UX-10.
4. `11-27-polish-ux-chrome-errors` — UX-03/04/05/08/09/11/12/13/14/15.

Each child: implement → targeted tests → preview/host proof → check → commit/push. Do not start
the next child until the previous one's findings are either fixed or explicitly deferred.

## Phase 3 — Integration review

- [ ] Re-run the primary editor/diff/merge/engine/first-file loops on the combined branches.
- [ ] Compare each finding to the actual behavior; quote the finding.
- [ ] Confirm the review evidence is intact.
- [ ] Confirm no unrelated feature work.
- [ ] Record deferred findings and residual risks.

## Phase 4 — Finish

- [ ] Spec update judgment for each child.
- [ ] Commit plan and push.
- [ ] Archive children and parent.
- [ ] Journal the session.

## Validation

Per child, the smallest sufficient set; at minimum for source changes:

```powershell
npm run check-types
npm run lint
npm test
npm run engine:smoke
npm run rust:test
```

Layout changes also run the affected `ux-review` Preview states; host behavior runs the matching
`ux-review` Host scenario (`UX_HOST_ONLY=...`).

## Rollback

Each child has its own branch; revert one child independently. The parent does not merge a child
that cannot pass its review gate.
