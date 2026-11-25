# Implementation plan — diff actions and body parity

## Sequencing

Run children in this order because fold sync and sticky headers share the node-start fold range:

1. `11-25-diff-prev-next-navigation`
2. `11-25-diff-collapsed-row-parity`
3. `11-25-diff-synced-folding`
4. `11-25-diff-sticky-header-parity`

## Per-child execution

- [ ] Write the child PRD/design/implement artifacts and activate the child.
- [ ] Build a red preview/unit probe before the fix.
- [ ] Apply the smallest fix at the documented seam.
- [ ] Re-run the probe green and the child's focused tests.
- [ ] Commit the child, archive it, and record the commit in the parent notes.

## Integration checks

- [x] `npm run check-types`
- [x] `npm run lint`
- [x] `npm run compile-tests`; `npm test --ignore-scripts` (920 passing)
- [x] full `webview-preview` seeded set (39 states)
- [x] fallow GREEN
- [x] `node esbuild.js --production`
- [x] `git diff --check`
- [ ] PR #42 push and CI green

## Review gates

- Child task acceptance criteria pass before the next child starts.
- Parent checks the combined diff for duplicate folding/navigation helpers.
- The final preview audit must prove navigation, synced folding, collapsed text and sticky text.
- No changes to merge-copy semantics, gutter availability or host protocol.

## Rollback

Revert the child commit or the parent integration commit. Each child is independently revertible.
