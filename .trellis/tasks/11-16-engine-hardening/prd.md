# v0.11.0 engine hardening

## Goal

Close the actionable findings from the v0.10.0 review and the robustness tracks of
the v0.11.0 feature plan, without shipping a release. The result is one PR against
`main` that makes the Rust engine survive a crash, accepts documents larger than the
frame limit, pairs renamed containers in the semantic diff, moves the copy planner
into Rust, and closes the platform, documentation, supply-chain and CI gaps.

## Source requirements

- `research/v0-10-review.md` — findings 1–11 from the v0.10.0 review.
- `research/feature-plan.md` — v0.11.0 scope, P1–P9, F1–F4 and performance gates.

## Task map

| Child | Review findings | Plan items |
|-------|-----------------|------------|
| `11-16-engine-supervisor` | 1 | P1, P7, P8 |
| `11-16-large-doc-upload` | 2 | P2 |
| `11-16-rename-matching` | 3 | F1–F4 |
| `11-16-copy-planner-rust` | 6 | R5 copy planner |
| `11-16-hardening-cleanup` | 7, 9, 10, 11, benchmark label | P9, docs, supply chain, CI |

## Cross-child acceptance criteria

- [ ] `cargo fmt --check`, `cargo clippy -D warnings` and `cargo test` pass.
- [ ] `npm run check-types` and `npm run lint` pass.
- [ ] `npm run parity`, `parity:rows`, `parity:diff` and `parity:words` pass, or a
      documented intentional difference covers the changed case.
- [ ] `npm run engine:build` and `npm run engine:smoke` pass.
- [ ] Targeted Node/webview suites pass; extension-host suites covering the engine,
      merge and editing paths run on Windows.
- [ ] `rust/README.md`, `CHANGELOG.md` (Unreleased) and the platform support note
      describe the shipped behavior.
- [ ] The new engine operations are exercised by tests: supervisor restart, chunked
      open, rename shapes, copy plan parity and health output.
- [ ] No version bump, tag or release workflow run.

## Deferred with rationale

The review and plan contain four items that need a separate architectural change.
They are recorded in the parent `implement.md` and in `research/feature-plan.md` and
are not part of this PR:

1. **P3 protocol cancellation** — the engine is single-threaded, so cancellation
   needs a request queue and a worker thread. The supervisor makes a process
   restart a safe coarse cancel; finer cancellation is a follow-up.
2. **P4 incremental re-parse** — about 1.7 s per non-value edit at 26 MiB. It needs
   a scanner that can restart at an XML boundary and preserve node identity.
3. **P5 row windows / engine-built first store** — the 49 MiB row payload and the
   second document copy need a protocol shape shared with the webview.
4. **R2/R3/R6/R7 ports** (index, validation, text features, cutover) — the large
   v0.11.0 rewrite; each needs its own parity corpus and release slice.
5. **Scanner fuzzing** — `cargo deny` covers advisories and sources, but a
   `cargo fuzz` scanner target is not added in this PR; it needs nightly CI and a
   seed corpus. Recorded here as the follow-up requested by the cleanup PRD.

## Constraints

- Keep the extension protocol additive; existing `doc.open` and single-frame
  operations keep working.
- No domain logic moves into TypeScript; changes in `host/` stay glue.
- Do not change diff results except where a requirement explicitly asks for it.
- Do not release, tag or bump `package.json`.

## Final integration review

The parent owns the final checks after every child is archived: full test sweep,
parity, changelog wording, PR body and the deferred list above.
