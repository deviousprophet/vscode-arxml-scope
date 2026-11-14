# Implement — plan coverage expansion

Owned by `11-14-test-coverage-expansion`. One test per plan row, named with its ID.
Batches land in the layer the plan names; each batch runs `npm test` plus the area gate.

## Progress (2026-11-15)

122 of 127 plan rows are executable under their IDs; five are re-scoped with reasons.

| Area | Rows | Where |
|---|---|---|
| SCAN | 01–10 | `core/planScan.test.ts` |
| ID | 01–05 | `core/planIdentity.test.ts` |
| ROW | 01–09 | `core/planRows.test.ts`, `core/planRowsExtra.test.ts` |
| COND | 01, 02, 05, 06 (03/04 re-scoped) | `core/planConditions.test.ts` |
| EDIT | 01–10 | `extension/editing.test.ts` |
| FIELD | 01–05 | `extension/editing.test.ts` |
| STRUCT | 01–06 | `extension/structureEdit.test.ts` |
| NAV | 01–05 | `extension/reveal.test.ts`, `references.test.ts` |
| DETAIL | 01–04 | `webview/components/detailsEditor.test.ts`, page suite |
| TREE | 01–06 | page suites |
| SEARCH | 01–04 | `webview/page/search.test.ts` |
| CPANEL | 01–03 | `webview/components/conditionsPanel.test.ts` |
| INDEX | 01–06 | `extension/planIndexValidation.test.ts` |
| VALID | 01–04 | `extension/planIndexValidation.test.ts` |
| FEAT | 01–02 | `extension/textFeatures.test.ts` |
| DIFF | 01, 03–05 (02 re-scoped) | `core/planDiff.test.ts`, page suite |
| ENG | 02–06, 08 (01/07 re-scoped) | `extension/engine.test.ts` |
| MERGE | 01–15 | `extension/planMerge.test.ts`, `compare.test.ts`, page suite |
| PKG | 01–03 | `extension/planEnginePackaging.test.ts` |
| PERF | 01–06 | `extension/planEnginePackaging.test.ts` |
| X | 01–05 | page suites, `compare.test.ts` |

## Re-scoped rows (recorded in TEST_PLAN known gaps)

- COND-03: ambiguous same-tail candidates are reported as one missing symbol.
- COND-04: stored overflow past 200 is dropped silently; the panel now caps Add.
- DIFF-02: the three-way merge was removed; two-file pairing is covered.
- ENG-01: restart/backoff is not implemented.
- ENG-07: no engine-RSS measurement exists.

## Findings from the batches

- SCAN-08: out-of-range numeric entity threw `RangeError` — fixed.
- SEARCH-03: an in-place `documentPatch` left the search index stale — fixed.
- MERGE-06: ancestor chains were inserted beside the parent row, not inside it — fixed.
- EDIT-05/PERF-03: the engine's second edit of the same value planned against the old
  span and could corrupt the text — fixed.

## Final validation

`npm test` 909 passing, `npx tsc --noEmit`, `npm run lint`, `cargo test` 35, clippy,
fmt, `parity:rows` 82/82, `parity:diff` 159/159, `parity:words` 44/44, engine smoke,
fallow complexity 0 / duplication 0 (two build-entry false positives reported).
