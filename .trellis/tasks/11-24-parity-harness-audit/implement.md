# Implementation plan — prune the TypeScript/Rust parity harness

## Branch gate

- [ ] Start from `main` after `feat/ecuc-diff-vscode-gutter` and
      `feat/webview-preview-skill` merge. Do not mix this task with either branch.
- [ ] Create `feat/parity-harness-audit` in its own worktree.
- [ ] Copy this task directory there; do not re-plan from scratch.
- [ ] `task.py start 11-24-parity-harness-audit` only after the artifacts are reviewed.

## Phase 0 — Baseline evidence

- [ ] Record `npm run parity`, `parity:rows`, `parity:diff`, `parity:copy`,
      `parity:words` exit status and time. Note whether each needs `cargo build -p
      arxml-cli`.
- [ ] Inventory every reference:
      `rg -n "parity(:|\\.mjs)|oracle(Rows|Diff|Copy|Words)|src/test/parity"`.
- [ ] For each oracle, list the exact TS imports and the non-test production consumers.
- [ ] Confirm `parity.mjs` is a fixture-manifest check, not an algorithm oracle.
- [ ] Write the classification table in the task notes before editing.

## Phase 1 — Decide

- [ ] Classify every script/oracle as `keep`, `remove` or `replace`; default to `remove`.
- [ ] For each `keep`, state the production consumer, the failure it catches and the CI
      job that will run it. A live production path without a CI job is not enough.
- [ ] For each `remove`, state why no production consumer exists.
- [ ] For each `replace`, state the golden-file location and regeneration command.
- [ ] Do not relocate a check that has no live consumer into `src/test`; delete it.
- [ ] If a check is retained, move it out of `scripts/` into a test-owned path and remove
      its esbuild bundle step.
- [ ] Confirm no TypeScript production module becomes unused as a result; if it does,
      make that a separate ownership decision, not a silent deletion.

## Phase 2 — Remove or wire

### Remove

- [ ] Delete the script under `scripts/`.
- [ ] Delete the matching `src/test/parity/oracle*.ts`.
- [ ] Remove the `parity:<name>` alias from `package.json`.
- [ ] Remove the CI step from `.github/workflows/ct.yml`.
- [ ] Remove the oracle entry from `.fallowrc.json` when none remain.
- [ ] Update `docs/TEST_PLAN.md`, `AGENTS.md` and any other mention.
- [ ] Delete `scripts/parityFixtures.mjs` if it has no remaining importer.

### Keep

- [ ] Add the check to `.github/workflows/ct.yml` after `engine:build`.
- [ ] Add an explicit timeout and a first-mismatch summary.
- [ ] Document the trigger and expected runtime in `docs/TEST_PLAN.md`.
- [ ] Add the check to the final verification list.

### Replace

- [ ] Add the deterministic Rust golden fixture.
- [ ] Add the comparison script/command and a reviewed `--update` path.
- [ ] Remove the TypeScript oracle and its esbuild bundle step.
- [ ] Document regeneration and review expectations.

## Phase 3 — Docs and manifests

- [ ] `package.json` has no alias for a removed script.
- [ ] `.fallowrc.json` has no stale oracle entry.
- [ ] `.github/workflows/ct.yml` names only live commands.
- [ ] `docs/TEST_PLAN.md` lists the retained parity checks and removes the retired ones.
- [ ] `docs/README.md` / `README.md` mention only user-facing checks; agent commands stay
      in `AGENTS.md` or the relevant skill.
- [ ] `rg` returns no live reference to a removed file or command.

## Phase 4 — Verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run engine:smoke`
- [ ] `npm run rust:test`
- [ ] every retained `npm run parity*`
- [ ] `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs` -> GREEN
- [ ] `node esbuild.js --production`
- [ ] `git diff --check`

## Review gates

- [ ] Every remaining parity file has a named production reason and a CI owner.
- [ ] Every removed file has no live package, CI, fallow or doc reference.
- [ ] `parity.mjs` is kept as a manifest check unless its guarantee moved to Rust.
- [ ] No production TypeScript module was removed just because it duplicates Rust.
- [ ] Retained checks fail visibly on a deliberate mismatch.
- [ ] Full extension/Rust/fallow/production gates pass.

## Rollback

- [ ] Revert the task commits; restore the removed scripts/oracles and their CI/docs
      entries. No runtime, protocol or persisted-data migration.

## Execution notes (2026-11-25)

### Baseline before edits

`node_modules` was missing at worktree start: installed with `npm ci`. `dist/engine` and
the debug CLI were built with `npm run engine:build` and
`cargo build --manifest-path rust/Cargo.toml -p arxml-cli`.

| Command | Exit | Time | Binary it needs |
|---|---|---|---|
| `npm run parity` | 0 | 4.3 s | `cargo run -p arxml-cli` (built on demand) |
| `npm run parity:rows` | 0 | 8.6 s | `rust/target/debug/arxml-cli` |
| `npm run parity:diff` | 0 | 18.5 s | `rust/target/debug/arxml-cli` |
| `npm run parity:copy` | 0 | 1.6 s | `rust/target/debug/arxml-cli` |
| `npm run parity:words` | 0 | 1.6 s | `rust/target/debug/arxml-cli` |

All five passed (45 fixtures; 90 row combinations, 177 diff pairs, 9 copy cases,
44 word pairs).

### Consumer inventory

| Check | TypeScript entry points | Non-test production consumer | Classification |
|---|---|---|---|
| `scripts/parity.mjs` | `parityFixtures.mjs` walk vs `arxml-cli fixture-manifest` | none; only the parity scripts and the CLI subcommand consume the manifest | **remove** |
| `scripts/parityFixtures.mjs` | fixture walk | only `parity.mjs` | **remove** with its last importer |
| `scripts/parityRows.mjs` | `oracleRows.ts` -> `scanEcucValues` + `buildRows` | `scanEcucValues` in `commands.ts`, `host/ecucEdit.ts`, `host/ecucStructureEdit.ts`, `host/ecucEditorProvider.ts`, `host/textFeatures.ts`; `buildRows` in `host/ecucEditorProvider.ts:285` | **keep** as `src/test/parity/rowParity.test.ts` (`npm test`) |
| `scripts/parityDiff.mjs` + `oracleDiff.ts` | `buildDiffDocument` | none; `diffModel.ts` production imports are types and `compareTitle` (`host/diffPanel.ts`) | **remove** |
| `scripts/parityCopy.mjs` + `oracleCopy.ts` | `planCopy`/`planDelete`/`wrapWithAncestors` from `core/copy/planCopy.ts` | none; `host/diffPanel.ts` calls `engine.planCopy` -> `coreEngine.ts` -> Rust `copy.plan`; the TS planner is imported only by tests and `copyBenchmark` | **remove** |
| `scripts/parityWords.mjs` + `oracleWords.ts` | `diffWords` | none; `documentRows.ts` imports only the `WordPair`/`WordSegment` types | **remove** |
| `src/test/parity/oracleRows.ts` | oracle helper | imported by `src/test/extension/engine.test.ts` and the new parity test | **keep** (test-owned) |

`scripts/parity.mjs` was verified as a fixture-manifest check (paths, sizes and
SHA-256 from the TypeScript walk vs `arxml-cli fixture-manifest`), not an algorithm
oracle. It protects no production path: its only consumers were the four oracle
scripts (all removed) and the CLI subcommand itself. The fixture corpus is still
exercised by the row parity test, so the manifest guarantee has no remaining
consumer; the CI step goes with the script.

### Retention details

- `src/test/parity/rowParity.test.ts` starts one engine process, opens every `.arxml`
  fixture and compares `doc.rows` with `oracleRows` for the `all` and `declaration`
  sorts. It replaces the esbuild+CLI script, needs no debug build (the release engine
  from `engine:build` is in `npm test`'s pretest), and reports the first difference per
  fixture plus the failure count. A deliberately corrupted oracle made the suite fail
  with a visible per-fixture mismatch list and a non-zero exit.
- `oracleRows.ts` lost its `oracleRows.cjs` entry-point block; it is now a plain test
  module.
- `lineBreakOf` in `core/copy/planCopy.ts` lost its `export`: `oracleCopy.ts` was its
  only external consumer, and keeping it exported made fallow non-green.

### Removed from manifests and docs

- `package.json`: `parity`, `parity:rows`, `parity:diff`, `parity:copy`,
  `parity:words` removed.
- `.github/workflows/ct.yml`: both parity steps removed; the row parity test runs in
  `UT_Test` (`npm test`) on all four OSes.
- `docs/TEST_PLAN.md`: the layer table and regression gates point at the test-owned row
  parity suite; no `parity:*` name remains.
- `rust/README.md`, `rust/arxml-cli/src/main.rs`, `rust/arxml-core/src/{diff.rs,
  ecuc/model.rs, lib.rs}`, `rust/arxml-cli/Cargo.toml`: the CLI is described as a debug
  probe; no CLI surface or engine protocol change.
- `.trellis/spec/frontend/{editor-lifecycle,directory-structure,quality-guidelines}.md`:
  stale "parity oracle" wording replaced.
- `.fallowrc.json` unchanged: one oracle (`oracleRows.ts`) remains.

### Verification (final tree)

| Gate | Result |
|---|---|
| `npm run check-types` | pass |
| `npm run lint` | pass |
| `npm run engine:smoke` | pass (protocol 1, `loadMs` 53, exit 0) |
| `npm run rust:fmt` / `rust:clippy` | pass |
| `npm run rust:test` | pass (60 + 5 tests) |
| `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs` | GREEN (dead-code 0, complexity 0, duplication 0) |
| retained row parity suite | pass (90/90 combinations, ~1 s) |
| deliberate mismatch in the oracle | fails with a per-fixture mismatch list and a non-zero exit |
| `node esbuild.js --production` | pass |
| `git diff --check` | clean |
| `npm test` | pass: 908 tests, 58 s, exit 0 (run as `npm test --ignore-scripts` after `compile-tests` and `node esbuild.js`; the first plain run was killed by the 30-minute shell timeout during the 388 MB VS Code download, not by a test failure) |

