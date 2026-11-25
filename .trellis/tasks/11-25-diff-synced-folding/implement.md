# Implementation plan — synchronized diff folding

- [x] Confirm the node-start fold ranges from the collapsed-row child.
- [x] Add the pinned folding-contribution declarations.
- [x] Extract `diffFolding.ts` and its unit tests.
- [x] Wire `onDidChangeHiddenAreas` for both inner editors with a re-entry guard and serialized syncs.
- [x] Extend the `diff-collapsed` preview state to fold from each side in turn and record both panes.
- [x] Verify left-to-right, right-to-left, nested and one-sided folds.
- [ ] Full gates and preview set.
- [ ] Commit the child and record the commit in the parent.

## Evidence

`diffFolding.test.ts` covers collapsed-key extraction, one-sided keys, target expansion and
equal-state no-ops (4 passing).

`diff-collapsed` folds `Items` on the modified pane first and then on the original pane. For
both directions the audit records the full `Items "Items"` header and `"⋯"` fold hint in both
panes, with no `P0000` child row. The test passed after adding the node-start ranges; before
that, the fold command found no region at the node line.

The event adapter uses the pinned `editor.contrib.folding` contribution, maps ranges through
the side line-key arrays, and serializes syncs through `foldSyncQueue` so rapid fold events
cannot double-toggle. `foldingModel` and `syncFolds` do not touch the host protocol.

The full parent gates and full seeded set run after the sticky child.
