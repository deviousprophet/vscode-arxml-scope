# Implementation plan — synchronized diff folding

- [ ] Confirm the node-start fold ranges from the collapsed-row child.
- [ ] Add the pinned folding-contribution declarations.
- [ ] Extract `diffFolding.ts` and its unit tests.
- [ ] Wire `onDidChangeHiddenAreas` for both inner editors with a re-entry guard.
- [ ] Sync once after model replacement and after Swap.
- [ ] Add the `diff-folds` preview state and hidden-key probe.
- [ ] Verify left-to-right, right-to-left, nested and one-sided folds.
- [ ] Full gates and preview set.
- [ ] Commit the child and record the commit in the parent.
