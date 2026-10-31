# Implementation plan

1. Add the benchmark runner + ECUC benchmark.
2. Align `package.json` scripts.
3. Align root configs.
4. Update GitHub workflows: CT benchmark job; package/release/fallow.
5. Add docs/examples placeholders where useful.
6. Run benchmark, tests, package; verify no scripts references.

## Rollback

One child commit; revert config/workflow/benchmark files without touching domain code.
