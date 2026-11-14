# Expand test coverage across all features

## Goal

Turn [`docs/TEST_PLAN.md`](../../../docs/TEST_PLAN.md) into executable tests: add the
edge cases it lists for every feature, wire the regression gates it defines, and close
the tracked gaps. The feature work itself already exists; this task hardens it.

## Context

`docs/TEST_PLAN.md` maps 21 feature areas (`SCAN`, `ID`, `ROW`, `COND`, `EDIT`, `FIELD`,
`STRUCT`, `NAV`, `DETAIL`, `TREE`, `SEARCH`, `CPANEL`, `INDEX`, `VALID`, `FEAT`, `DIFF`,
`ENG`, `MERGE`, `PKG`, `PERF`, `X`) with a stable ID per case, the layer that should own
it, the expected behaviour, and a regression-gate table. The current suite is 803 tests
in 76 files; the plan lists roughly 120 additional cases.

The plan is deliberately a backlog, not a specification of behaviour: each row asserts
what the code already promises in `docs/ECUC_EDITOR.md`, `docs/DIFF.md`,
`docs/MERGE.md` or `.trellis/spec/frontend/`. A row that reveals a defect becomes a fix
in this task only when the fix is small; otherwise it spawns its own task.

## Requirements

- **R1 — One case, one test.** Each implemented row is a test whose name starts with its
  ID (`SCAN-01`, `MERGE-14`, …), in the suite the plan names.
- **R2 — No fixture writes.** A test that writes hashes the fixture directory before and
  after and asserts nothing changed.
- **R3 — Deterministic assertions.** No dependence on time, locale or map order; ceilings
  are wide and record the measured number.
- **R4 — Gates become commands.** The plan's regression-gate table is encoded where it
  can be run: a documented command set per area in `docs/TEST_PLAN.md`, and `npm test`
  keeps covering every area it covers today.
- **R5 — Gaps closed or re-scoped.** Engine restart/backoff (`ENG-01`), protocol
  malformed/oversized frames, panic survival, and a scanner fuzz corpus are either
  implemented and tested or explicitly moved to a follow-up task with a reason.
- **R6 — No behaviour change without a test.** A row that fails reveals a real defect;
  the fix lands with its test and a changelog entry if user-visible.

## Acceptance criteria

- [ ] Every `P0` row in `docs/TEST_PLAN.md` has a matching test, and the plan marks it
      done with the test file.
- [ ] `npm test`, `cargo test`, `parity`, `parity:rows`, clippy and fmt pass.
- [ ] The regression-gate table is accurate: for each area, running the named command set
      covers the rows in it.
- [ ] Every row added since the plan was written either passes or links to the task that
      owns the fix.
- [ ] `docs/TEST_PLAN.md` ends with no stale "to add" rows for covered areas.

## Out of scope

- New product features. A failing row is a bug report, not a feature request.
- Replacing the fixtures with a real customer file; the plan forbids it.
- Broad coverage metrics; the unit of work is the named case, not a percentage.

## Notes

- The plan's `MERGE` rows already have partial coverage; those are the reference for the
  style of the rest.
- Prefer table-driven tests where several rows share a shape (scanner fixtures, row
  formatting, conflict matrix).
