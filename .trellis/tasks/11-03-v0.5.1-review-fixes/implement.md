# Implementation plan: v0.5.1 review fixes

1. Replace the spread in `WorkspaceIndex.ensureLookups`; add the empty-lookup fallback and a 200k-element regression test.
2. Wrap the definition lookup call in `renderRows.definitionFor`; add a throwing-lookup test.
3. Capture the `UUID` attribute and the `<UUID>` element; update the fixture to the attribute form and keep an element-form assertion.
4. Add `UPPER-MULTIPLICITY-INFINITE` to the builder and normalization; add fixture/tests.
5. Add `dirtyDuringBuild`, the `try/finally` rebuild, and the `start()` catch; add a focused test where a watcher reindex lands during a rebuild if practical.
6. Add `src/test/benchmarks/indexBenchmark.ts`; run `npm run benchmark`.
7. Update `docs/ECUC_EDITOR.md` limitations.
8. Run `npm run check-types`, `npm run lint`, `npm test`, `npm run benchmark`.

Rollback point after step 2: the crash is gone and row building is defensive; later steps are additive.
