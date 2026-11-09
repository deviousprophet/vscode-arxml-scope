# Code review — standards and spec

Fixed point: `main` (working tree, branch `feat/scalable-rename-matching`).

Two parallel reviews were run: a standards review against the repo specs and the smell
baseline, and a spec review against `prd.md` / `design.md` / `implement.md`.

## Standards findings and resolution

| Finding | Resolution |
|---|---|
| New benchmark `_type` had no summary renderer in `.github/scripts/summarize-tests.mjs` | Added a `rename-scale` table renderer. |
| `semanticLimitReason` union was redeclared in three interfaces | Added one exported `SemanticLimitReason` and reused it. |
| `'watchdog'` reason and wording were unreachable | Removed from the code path and the design; the deterministic budget is the only limit in this scope. |
| Test-only `semanticPairBudget` sat in the production options without a note | Marked `@internal` and documented it as a test-only override. |
| Duplicated group/zip and token-postings loops | Extracted `groupBy` and `buildTokenPostings`; reused in candidate generation, identical-child pairing, fallback and name learning. |
| Nested reason ternaries in the webview | Replaced with a typed `LIMITED_NOTICE` map and a literal guard over the `any` document seam. |
| Benchmark header described the branch's own past | Rewritten as a neutral baseline and regression-guard note. |
| `semanticSkipped` was added twice for a budget-limited bucket | Removed the `assignSemantic` increment; the bucket now counts once in `semanticPass`. The test asserts the exact 980 leftover count. |
| Reason precedence always preferred budget | Added per-limit counters and chose the reason with more leftovers. |
| Identical-child fallback could pair unrelated names by position | Restored the name-score gate (0.5) before the position pairing; added a 500-container unrelated-name regression test. |

## Spec findings and resolution

| Finding | Resolution |
|---|---|
| E6 deferral used only a small synthetic probe, not a 42 MB-class shape | Added a 42 MB-class synthetic probe: 1,000 targets, 100 reference files, 100k references, full rebuild 75 ms. Deferred E6 below the 100 ms gate; corpus shape recorded in `research/01-reverse-map-measurement.md`. |
| Docs lacked measured limits | Added the 0.2 s / 0.1 s local measurements, the 3 s / 6 s CI guards and the budget/fallback notice behavior to `docs/DIFF.md`. |
| Changelog not updated | Added an `[Unreleased]` section with the user-visible changed/fixed outcomes. |
| Missing branch tests for stop tokens and deterministic identical pairing | Added a 500-container unrelated-bucket test and a repeat-run deterministic identical-child test. |
| Benchmark thresholds had no baseline/tolerance note | Added the local baseline and the regression-guard rationale beside the limits. |

## Residual limitation

A real customer 42 MB-class workspace was not available in this environment. E6 remains
deferred on the synthetic 42 MB-class shape (75 ms) and must be re-measured on real data
before an incremental reverse map is implemented.
