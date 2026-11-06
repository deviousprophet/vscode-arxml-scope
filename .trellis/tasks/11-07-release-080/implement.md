# Implement — 0.8.0

## Phase 0 — Baseline

- [ ] Run `npm run check-types`, `npm run lint`, `npm test`, `npm run benchmark` on the branch.
- [ ] Record the current semantic benchmark, validation time and reference lookup time in the task
      notes.
- [ ] Confirm `semanticMatching: false` output is captured for the semantic fixtures (golden rows).

Gate: baseline green; numbers recorded.

## Phase A — Semantic rename matching

- [ ] Add name-first seed collection inside `semanticPass`.
- [ ] Allow single-pair substitution learning with the confidence floor.
- [ ] Iterate learn/assign up to three passes; merge substitutions without conflicts.
- [ ] Add the identical-child tie path (name, then position).
- [ ] Add the above-limit name/position fallback and `semanticSkipped` count.
- [ ] Extend `DiffMatch` / `DiffDocument`; update the diff viewer notice.
- [ ] Tests: 25/20/15/10/5 embedded children, single rename, identical siblings, fallback, Strict
      parity.
- [ ] Benchmark: add the embedded-name corpus and assert pairing count and elapsed time.

Gate A: all semantic fixtures pass, Strict output unchanged, benchmark under its budget.

Commit: `fix(diff): pair renamed containers by learned name substitutions`.

## Phase B — Index correctness

- [ ] Add the rebuild epoch and discard stale `reindexFile` results into `dirtyDuringBuild`.
- [ ] Test the deferred-read race: reindex starts before rebuild, completes after `replaceAll`; the
      newest content wins.
- [ ] Add the pure byte-decoder module with BOM and XML-declaration detection.
- [ ] Wire streaming decode; report unsupported encodings as skipped.
- [ ] Tests: UTF-8 BOM, UTF-16LE BOM, UTF-16BE BOM, split BOM, unsupported encoding, plain UTF-8.

Gate B: race and encoding tests pass; full suite green.

Commit: `fix(index): guard rebuilds and decode declared encodings`.

## Phase C — Index performance

- [ ] Replace the rebuild-on-generation lookup with incremental add/remove.
- [ ] Keep `buildLookup` as the reference implementation for tests.
- [ ] Add a comparison test: random upserts/removes match a fresh full build.
- [ ] Add the reverse-reference map with per-file invalidation.
- [ ] Benchmarks: one-file upsert at 200k elements (<50 ms), Find References at 42 MB (<100 ms
      warm), retained memory within 512 MiB.
- [ ] Verify navigation, validation and text features still resolve copies and ambiguous paths.

Gate C: lookup and reference benchmarks meet their budgets; full suite green.

Commit: `perf(index): maintain lookups incrementally and cache reverse references`.

## Phase D — Bounded scans

- [ ] Cache symbols and links per document version in `TextFeatures`.
- [ ] Keep the existing size cap; document it. Add a setting only if the 40 MB benchmark still blocks.
- [ ] Split `validateWorkspace` into preparation and per-file rule steps.
- [ ] Run validation in slices with `setImmediate`, cancel on a newer generation, publish once.
- [ ] Show the validation status in the status bar and restore it on completion.
- [ ] Test diagnostics equality against the synchronous baseline; add slice-latency instrumentation.
- [ ] Benchmark: 36 MB validation, text-feature open on 40 MB.

Gate D: no slice above 50 ms, diagnostics identical, text-feature cache hit, full suite green.

Commit: `perf(host): cache text features and validate in slices`.

## Phase E — Docs and release

- [ ] Update `docs/DIFF.md` and `docs/ECUC_EDITOR.md`.
- [ ] Add `## [0.8.0] - <date>` to `CHANGELOG.md` with user-visible `Changed` and `Fixed` entries.
- [ ] Run `node .github/scripts/extract-release-notes.mjs v0.8.0`.
- [ ] Set `0.8.0` in `package.json` and both `package-lock.json` version fields.
- [ ] Run the full gates: `npm test`, `npm run benchmark`, `npm run package`, `npx @vscode/vsce ls`.
- [ ] Open the PR, confirm CI, merge, then tag `v0.8.0` only after explicit approval.

Gate E: full gates green, release notes valid, version fields agree, CI green.

## Rollback points

Each phase is its own commit. Reverting a phase commit leaves the earlier phases intact; the version
bump and tag are last, so an implementation rollback never touches a published release.

## Validation commands

```powershell
npm run check-types
npm run lint
npm test
npm run benchmark
npm run package
npx @vscode/vsce ls
node .github/scripts/extract-release-notes.mjs v0.8.0
```
