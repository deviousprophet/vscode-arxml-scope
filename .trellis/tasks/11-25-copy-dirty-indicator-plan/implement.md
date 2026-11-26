# Implementation plan — merge-copy responsiveness and unsaved-copy indication

> Local planning only. Do not start or commit with the current PR.

- [ ] Create the next branch from `main` after PR #42 merges.
- [ ] Instrument the current copy path and capture 1/10/100-row timings.
- [ ] Decide the targeted patch protocol from measured hot spots.
- [ ] Add host copied-row/dirty state and targeted copy acknowledgement.
- [ ] Add editor dirty-line decorations and clear-on-save/undo behavior.
- [ ] Add diff dirty-side/row decorations.
- [ ] Add refusal/stale-copy rollback and scroll/fold preservation.
- [ ] Add preview states and host tests for dirty, save, refusal and undo.
- [ ] Run full gates and compare the benchmark.
- [ ] Document the user-visible dirty semantics.

## Validation

- Benchmark before/after for 1, 10 and 100 rows.
- Host tests prove source stays clean and target clears only on save.
- Preview checks prove editor and diff dirty markers are visible before save.
- Full test suite, types, lint, fallow and production bundle.

## Rollback

The copy path and dirty protocol are additive; remove the new messages/decorations if the branch is
abandoned.
