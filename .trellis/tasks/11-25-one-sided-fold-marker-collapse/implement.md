# Implementation plan — one-sided marker and Collapse All

- [x] Add one-sided-root, shared-root/one-sided-descendant and name-only marker tests.
- [x] Require `left` and `right` on the collapsed root before marking.
- [x] Pass both source and target row maps into `foldTogglePlan`.
- [x] Skip keys missing from either side.
- [x] Add the last-event-wins fold sync version.
- [x] Add `diff-collapse-all` and its probe.
- [x] Isolate fold-only preview states from gutter/sash gestures.
- [x] Full preview set, types, lint, tests, fallow, production and `git diff --check`.
- [ ] Commit, push and check CI.

## Evidence

- `diffFoldIndicator.test.ts`: one-sided root false, shared root with one-sided descendant true,
  name-only root false, substantive root true.
- `diffFolding.test.ts`: target-only collapsed row is not unfolded; shared keys still toggle.
- `diff-collapse-all`: left-only `RemovedMod` and shared `Shared` headers stay visible;
  `RemovedValue` and `ChangedValue` are hidden.
- Full preview set: 41 states, `failed: 0`.
- 928 tests passing; types, lint, fallow (dead code 0, complexity 0, duplication 0), production
  bundle and `git diff --check` pass.
