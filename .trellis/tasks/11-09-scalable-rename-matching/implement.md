# Implementation plan — scalable rename matching

## 0. Preconditions

- [ ] Create a feature branch from `main` (the current worktree is on a detached HEAD):
      `git switch -c feat/scalable-rename-matching`
- [ ] Set the task branch:
      `python ./.trellis/scripts/task.py set-branch 11-09-scalable-rename-matching feat/scalable-rename-matching`
- [ ] Review `prd.md`, `design.md` and `research/00-plan-and-rust-review.md`; resolve the
      CI time-bound and `engine-strict` open questions before implementation.
- [ ] `npm ci` on Node 24 / npm 11+ (the local npm 12 also works).

## 1. Baseline and failing tests

Purpose: prove the problem before changing the matcher.

- [ ] Add `src/test/benchmarks/renameScaleBenchmark.ts` with the E5 corpus:
  - one root, one definition group;
  - 500 left containers `NMH_MO_<n>` and 500 right `NM_MO_<n>`, 25 parameter children each,
    values embedding the old container name;
  - run 500 first (warm-up) and 700 second; print `{ renames, pairs, changed, added,
    removed, limited, elapsedMs, retainedMiB }`;
  - assert all 500/700 pair, 500 ≤ 3 s, 700 ≤ 6 s (calibrate on CI with a measured reason),
    and retained memory ≤ 128 MiB per case;
  - use `--expose-gc` via the existing `runBenchmark` harness.
- [ ] Add focused unit tests in `src/test/core/` for the branches that will change:
  - signature grouping pairs a consistent bulk rename;
  - rare-token candidate generation does not include the full product;
  - oversized bucket learns a substitution before the fallback;
  - budget-limited output is deterministic and reports the count/reason;
  - near-tie stays unpaired at the benchmark scale;
  - identical-children pairing stays deterministic.
- [ ] Run the new benchmark and expect red:
      `npm run benchmark renameScale`
  Current baseline: 500 pairs but ≈16 s; 700 pairs 0 and reports 1,400 skipped.
- [ ] Record the baseline output in the task notes or a research file.

Validation gate: the benchmark fails for the expected reasons; the new unit tests fail
against the current implementation (or are written to fail once the branch is removed).

## 2. Matcher core (E1, E2)

- [ ] In `src/core/diff/diffModel.ts`, introduce `SemanticNode` and the per-bucket
      precomputation from `design.md` §3.1.
- [ ] Replace the all-pairs loop in `assignSemantic` with the candidate generator:
  - exact signature groups;
  - child-key hash groups;
  - rare-token inverted index with high-frequency suppression;
  - bounded nearest fallback;
  - deduplication and deterministic caps.
- [ ] Make `scoreSemantic` consume the precomputed fields; keep the weights, floor, margin
      and Levenshtein behavior.
- [ ] Replace `learnNameSubstitutions`'s all-pairs token scan with the inverted-index /
      mutual-best seed pass; keep `learnSubstitutions` and its confidence rules.
- [ ] Replace `assignIdenticalChildren`'s all-pairs loop with signature/position grouping.
- [ ] Keep the existing `tryPair`/`matchedLeft`/`matchOfRight` flow and the "first exact,
      then semantic" ordering. Do not move semantic pairing ahead of the strict passes.
- [ ] Keep `SEMANTIC_PAIR_LIMIT` as a fallback safety; add the deterministic candidate
      budget from `design.md` §3.5. Do not add an unreachable wall-clock branch.
- [ ] Preserve `semanticSkipped`; add `semanticLimitReason` to `DiffDocument`.
- [ ] Run the focused tests and the benchmark:
      `npm run benchmark renameScale`
      `npx mocha ...` (or the repository's compiled test command) for the new core tests.

Validation gate: 500 and 700 all pair; 500 within the bound; deterministic counts across
three consecutive runs; existing `diffModel` tests pass.

## 3. Notice and protocol (E3, E4)

- [ ] Add the optional `semanticLimitReason` to `src/diffProtocol.ts` / the document type.
- [ ] Update `src/webview/diffViewer.ts` to read the reason and extend the existing
      `diff-semantic-skip` note (fallback/budget wording from `design.md` §6).
- [ ] Keep the old payload path: a document with only `semanticSkipped` shows the current release
      generic message.
- [ ] Add webview tests for each reason and the missing-field fallback.
- [ ] Verify the host sends the new field through `diffPanel`/`DiffSession` without a
      second document build; no re-scan on toggle.

Validation gate: the notice is visible for a limited comparison; Strict output and the
cached toggle tests are unchanged.

## 4. Reverse map (E6, conditional)

- [ ] Add the 42 MB-class measurement described in `design.md` §4.2. Record references,
      files, duplicate/suffix cases and rebuild time. A synthetic corpus is acceptable only
      if its shape is recorded; prefer real workspace data when available.
- [ ] **Go/no-go:** if the full rebuild is below the agreed threshold (proposed 100 ms),
      record the number and defer E6 with a note. Do not add the delta without evidence.
- [ ] If implementing: add the two-level index and dirty-target invalidation from
      `design.md` §4.3, with tests for add/remove/retarget/ambiguous/split-copy.
- [ ] Keep `referencesFor()` results identical to a full rebuild in every test.

Validation gate: `referencesFor()` correctness tests pass; the measured rebuild is below
the threshold or the delta shows a measured improvement without a stale entry.

## 5. Contributor setup (E7)

- [ ] Add `engines.node: ">=24"` and `engines.npm: ">=11"` to `package.json`.
- [ ] Add `.nvmrc` with `24`.
- [ ] Decide and test `engine-strict=true` in `.npmrc`; verify npm 11/12 `npm ci` passes
      and npm 10 fails with the version message.
- [ ] Add the README "Contributing" prerequisites and commands.
- [ ] Confirm CI still installs on Node 24 (`.github/workflows/ct.yml`) and update the
      Node version only if the baseline changes.
- [ ] Do not regenerate the lockfile with an older npm as a workaround.

Validation gate: clean-checkout `npm ci` on npm 11+; documented failure mode on npm 10.

## 6. Docs (E8)

- [ ] Update `docs/DIFF.md`:
  - blocking and candidate budgets;
  - oversized-bucket learning before fallback;
  - deterministic limited reason and notice wording;
  - measured 500/700 behavior and the retained limit;
  - relationship between the old 250k fallback and the new budget.
- [ ] Update `CHANGELOG.md` for the next release.
- [ ] Add a short note that Rust/WASM is planned for the Rust engine release under
      `.trellis/tasks/11-09-rust-core-engine/` and link the research file; do not add
      Rust code in this task.
- [ ] Do not duplicate the existing fallback explanation; edit it in place.

Validation gate: docs match the implemented behavior and the benchmark output.

## 7. Full verification

Run, in order:

```bash
npm run check-types
npm run lint
npm test
npm run benchmark
```

- [ ] All existing tests pass (baseline: 563 static `test()` declarations; use the actual
      suite output).
- [ ] All benchmarks pass; record the final numbers.
- [ ] The 500/700 benchmark passes with all pairs; the near-tie stays unpaired.
- [ ] No new runtime dependency; no `vscode` import under `src/core/**`.
- [ ] No new file writes or cache beside user files.
- [ ] Manual pass in VS Code: open a large ECUC diff, switch Semantic/Strict, trigger the
      limited notice, confirm rows/scroll/search still work.
- [ ] Check `git diff` for accidental fixture edits or generated files.

## 8. Review gates

1. **Design review** after §1–2: confirm the candidate generator does not miss valid
   pairs, the budget is deterministic, and thresholds are unchanged.
2. **Protocol/webview review** after §3: old payload compatibility, notice wording,
   no second notice system.
3. **E6 review** after §4: measurement or correctness proof; no unmeasured complexity.
4. **Release review** after §7: docs, changelog, benchmark numbers, no out-of-scope Rust
   or worker-thread changes.

## 9. Rollback points

- **Matcher commit:** revert the matcher changes as one unit; the `DiffSession` and
  `buildDiffDocument` signatures stay stable, so the webview/host do not need a revert.
- **Notice/protocol commit:** the optional field is additive; a rollback leaves old
  payloads working. Revert the webview text if needed.
- **E6 commit:** revert the workspace index delta independently; it is pure core and has
  no persisted state.
- **Contributor/docs commits:** independent; safe to revert without affecting runtime.

## 10. Out of scope / do not start

- Rust/WASM/native/sidecar work: planned for the Rust engine release under
  `.trellis/tasks/11-09-rust-core-engine/`. It starts only after the next release is finished;
  the TypeScript engine remains the oracle and fallback.
- Worker threads / moving the diff off the host thread.
- Incremental validation (unless the release is comfortably done and the follow-up is
  explicitly approved).
- New product features or schema/completion work.
