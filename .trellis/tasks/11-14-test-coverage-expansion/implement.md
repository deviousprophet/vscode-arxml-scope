# Implement — plan coverage expansion

Owned by `11-14-test-coverage-expansion`. One test per plan row, named with its ID.
Batches land in the layer the plan names; each batch runs `npm test` plus the area gate.

## Progress (2026-11-14)

| Batch | Rows | Status |
|---|---|---|
| SCAN | 01–10 | done — `src/test/core/planScan.test.ts` |
| ID | 01–05 | done — `src/test/core/planIdentity.test.ts` |
| ROW | 01–05, 07, 09 | done — `src/test/core/planRows.test.ts` |
| COND | 01, 02, 05, 06 | done — `src/test/core/planConditions.test.ts` |
| DIFF | 01, 03, 04, 05 | done — `src/test/core/planDiff.test.ts`, `diffPage.test.ts` |
| EDIT | 01–04, 06, 07, 09, 10 | done — `editing.test.ts`; 05/08 need an engine handle |
| FIELD | 01–05 | done — `editing.test.ts` |
| STRUCT | 01–06 | done — `structureEdit.test.ts` |
| NAV | 01–03 | done (ID-prefixed existing tests); 04/05 open |
| DETAIL | 02 | done; 01/03/04 open |
| TREE | 01 | done; 02–06 open |
| SEARCH | — | open |
| CPANEL | 01 | done; 02–03 open |
| INDEX | 01–06 | open |
| VALID | 01–04 | open |
| FEAT | 01–02 | done (ID-prefixed existing tests) |
| ENG | 01–08 | open (ENG-01 is a product gap) |
| MERGE | 01, 09, 14 | done; the host copy handler and the patch path still need tests |
| PKG | 01–03 | open |
| PERF | 01–06 | open; `diffBenchmark` exists, the others are commands |
| X | 01–05 | done: 01/02 page, 03/04/05 ID-prefixed existing tests |
| ROW | 06, 08 | open — annotation shapes, tail exception ordering |

## Findings from the first batches

- SCAN-08 exposed a real defect: an out-of-range numeric entity threw
  `RangeError` (`&#x110000;`). `decodeXml` now leaves it verbatim; changelog `Fixed`.
- SCAN-06's planned wording was wrong: with no text the model falls back to the
  `<VALUE>` element span. Plan row corrected.
- COND-02: `1 == 1.0` is true (both are numbers); only string/boolean vs number is
  unknown. Plan row corrected.
- COND-03 and COND-04 are re-scoped, not asserted: the evaluator lists an ambiguous
  symbol once, and the 201st entry is dropped without a notice. Both are in the plan's
  known gaps.
- DIFF-02 described the removed three-way merge; row re-scoped to the two-file suite.

## Validation per batch

`npm run compile-tests` for a fast loop, `npm test` before a commit, and the area gate
from the plan's regression table. Rust is untouched by these tests except where an
engine row lands.
