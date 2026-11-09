# Scalable rename matching

## Context

The current release ships semantic diff pairing, but it does not scale. A bulk rename of hundreds of
containers is the known weak spot: matching is O(n²) in the number of leftover containers
per definition group, and above the 250,000-pair bucket limit the linear fallback can pair
nothing because it runs before any rename substitution is learned. The current-release review also
left contributor setup broken for npm 10.

The source roadmap is `H:\workspace\ARXML_EXTENSION_FEATURE_PLAN.md` §3. This task is the
next-release scope. It also records the decision on the external Rust proposal: Rust is
evaluated in `research/00-plan-and-rust-review.md` and is **out of scope for this task**;
the Rust core engine is planned separately in
`.trellis/tasks/11-09-rust-core-engine/`.

## Goal

A bulk rename of hundreds of containers pairs correctly and quickly, and no part of the
matching work blocks the extension host for an unbounded time. Contributors can install the
project with the documented Node/npm versions, and the public diff documentation matches
the behavior.

## In scope

- **E1 — Candidate blocking.** Precompute a per-container signature (normalized name, token
  set, child-key multiset) once per comparison. Score only a bounded candidate set, using
  signature groups, rare tokens and deterministic ordinal alignment. Token sharing alone is
  not sufficient for the E5 corpus because all names share common tokens.
- **E2 — Oversized buckets learn substitutions.** Learn rename substitutions from an
  inverted token index / mutual-best seeds before the name-key fallback, so a single large
  bucket can pair. This must not reintroduce an O(n²) learning pass.
- **E3 — Deterministic work budget.** Keep the pairs found when a bucket reaches a
  deterministic work budget, record the reason and count, and stop cleanly. No wall-clock
  limit decides a pair in this scope.
- **E4 — Visible limitation notice.** Extend the existing current-release `diff-semantic-skip` note
  so it distinguishes fallback leftovers from budget-limited work and shows the count and
  reason. The toolbar or notice must make a limited comparison visible.
- **E5 — Tests and benchmark.** Permanent benchmark and tests for 500 and 700 renamed
  containers with 25 name-embedded children each under one definition. All pair; the
  stated time and memory bounds hold; a near-tie at that scale stays unpaired; removing a
  matching branch makes its test fail.
- **E6 — Incremental reverse map (conditional).** Measure the full rebuild on a 42 MB-class
  workspace (synthetic or real; record the corpus shape) first. If it is material, update
  the reverse-reference map per file/affected target with correct invalidation; if it is
  already cheap, record the measurement and defer the change.
- **E7 — Contributor setup.** Make the Node/npm requirement explicit so `npm ci` works for
  contributors: npm 10 fails today with `Missing: ansi-regex@5.0.1 from lock file`; npm 11
  and 12 pass. Add `engines.npm`, a Node 24 `.nvmrc`, and a README prerequisite note.
- **E8 — Docs.** Update `docs/DIFF.md` with blocking, budget, reason and notice behavior,
  and the measured limits. Do not duplicate the existing fallback explanation.

## Out of scope

- Rust, WASM, native addons, sidecars and language-server extraction. The Rust core-engine
  task owns that work after the next release; no Rust toolchain or artifact enters this
  task.
- Moving the diff or index work to worker threads. Measure after E1–E3; this is a separate
  change with its own protocol/serialization cost.
- Incremental validation. It is a worthwhile follow-up, but not required for the next release.
- New product features (schemas, completion, broader ARXML coverage, graph views, editing
  expansion).
- Changing the semantic thresholds, near-tie margin, Semantic/Strict behavior or the
  "never invent a pair" rule.

## Requirements

1. **Correctness is unchanged or better.** Existing pairing behavior on the current
   fixtures and tests must produce the same or a strictly better pairing. A near-tie must
   remain unpaired. An ambiguous case must not become a guessed pair.
2. **Bulk rename must scale.** The 500-container E5 corpus pairs all 500 within the agreed
   time bound; the 700-container corpus pairs all 700 within its bound. The benchmark runs
   in CI and fails on a regression.
3. **Determinism.** The same inputs and budget must produce the same pairs and the same
   limited count on every run. No wall-clock limit may decide whether a pair is kept or
   dropped.
4. **Bounded work.** No bucket may run an unbounded candidate loop. The budget must be
   recorded in the document and surfaced through the existing diff protocol.
5. **Reverse map.** `referencesFor()` after an upsert must return the same result as a full
   rebuild. If E6 is implemented, adding, removing, retargeting and ambiguous-suffix cases
   are covered by tests; if E6 is deferred, the measurement is recorded.
6. **Contributor setup.** A clean checkout with Node 24 / npm 11+ runs `npm ci` and the
   documented commands. npm 10 either fails with a clear version message or is explicitly
   documented as unsupported. CI stays green.
7. **No new runtime dependencies.** Core remains dependency-free and free of `vscode`
   imports. No cache or index data is written beside user files.
8. **Docs and release notes.** `docs/DIFF.md` describes the behavior a user sees, including
   the limited-comparison notice. `CHANGELOG.md` is updated for the next release.

## Constraints

- `src/core/**` stays pure: no `vscode`, no DOM, no new runtime dependency.
- Preserve the one-action/one-undo editing path and every write rule in
  `quality-guidelines.md`; this task should not touch the write path.
- Preserve `semanticMatching` default-on, the Strict toggle and the current score weights
  unless a measured reason and a test justify a change.
- Benchmarks must use synthetic data only; no customer files or identifying names.
- The benchmark thresholds must state the CI baseline and a tolerance; do not tune a
  threshold to make a red run pass without a measured reason.
- The existing `DiffDocument` protocol is shared with the webview; new fields are optional
  and backward-compatible with the current-release page.

## Acceptance criteria

- [ ] The 500-container / 25-embedded-children benchmark pairs all 500 in ≤ 3 s on the CI
      baseline, and retains no more memory than the agreed budget.
- [ ] The 700-container corpus pairs all 700 in ≤ 6 s on the CI baseline, or the agreed
      calibrated bound is documented with a measured reason.
- [ ] A near-tie at 500 containers stays unpaired; a deterministic test proves it.
- [ ] Candidate blocking, oversized-bucket learning, budget handling and notice rendering
      each have a test that fails when that branch is removed.
- [ ] The limited count and reason survive the host → webview protocol and are visible in
      the panel; Strict output is unchanged for the same inputs.
- [ ] `npm ci` succeeds on npm 11+ from a clean checkout; the README and `.nvmrc` state the
      required Node/npm versions; CI remains green.
- [ ] E6 has either a measured justification and tests, or a recorded deferral with the
      42 MB-class timing and corpus shape.
- [ ] `docs/DIFF.md` and `CHANGELOG.md` describe the final behavior.
- [ ] `npm run check-types`, `npm run lint`, the full test suite and all benchmarks pass.
- [ ] No new runtime dependency; no `vscode` import under `src/core/**`; no new file writes.
- [ ] The Rust/WASM decision is recorded and linked to the Rust core-engine task;
      no Rust code is implemented in this task.

## Resolved decisions

- **Budget type:** deterministic work budget; no wall-clock limit in this scope. This
  keeps diff output reproducible.
- **Rust:** planned for the Rust engine release, not the next release. See `research/00-plan-and-rust-review.md` and
  `.trellis/tasks/11-09-rust-core-engine/`. The Rust engine work starts with a Rust core
  foundation and parity harness, then migrates index, validation and semantic matching;
  the TypeScript engine remains the oracle and fallback.
- **E4:** extend the existing `diff-semantic-skip` note; do not add a second notice system.
- **E6:** go/no-go after a 42 MB-class measurement (synthetic or real, with the corpus
  shape recorded); do not assume 390 ms.

## Open questions

- Exact CI hardware calibration for the 500/700 time bounds. Resolve with a measured
  baseline on the CI runner before freezing the numbers.
- Whether `engine-strict=true` is acceptable for contributors, or whether a warning plus
  README is enough. Prefer a clear failure over a cryptic lockfile error.
- Whether `semanticSkipped` should remain a single number or gain a companion
  `semanticLimited` reason field. Design chooses the backward-compatible shape.
