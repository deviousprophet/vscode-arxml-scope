# Semantic Diff Matching Code-Spec

The semantic matcher is the second pairing pass inside the diff model. It keeps a renamed
module or container as one **changed** row instead of an add + remove pair. The strict
pairing rules still run first; this pass only sees modules/containers the strict rules left
unpaired.

Source: `src/core/diff/diffModel.ts`. User-visible behaviour: [`docs/user/DIFF.md`](../../../docs/user/DIFF.md).
Parity surface: [`diff-parity.md`](./diff-parity.md).

## Trigger

`arxmlScope.diff.semanticMatching` (default `true`) is read when a comparison is built.
The toolbar **Semantic** / **Strict** group changes only the current panel; it posts
`{ type: 'matchMode', semantic }` and does not write the setting. The host rebuilds the
comparison from the prepared rows/ranges and a `DiffSession` document cache; a changed
document version falls back to a full refresh.

## Pairing rules

1. **Eligibility.** Pair only modules or containers with the same `DEFINITION-REF` and the
   same parent. Parameters and references keep the strict rules.
2. **Name learning.** Mutual-best name pairs can teach a token substitution (for example
   `NMH→NM`) before child values are scored, so children whose values embed the old
   container name do not deadlock the match. A single unambiguous rename is enough.
3. **Candidate blocking.** Group candidates by a digit-normalized name signature and by
   their child-key multiset; rare name tokens provide a short candidate list. Only that
   list is fully scored; a large definition group is not compared exhaustively.
4. **Score.** `children 0.55 + shortName 0.30 + relativePosition 0.10 + learnedTokens
   0.05`. Accept at `>= 0.62`.
5. **Iteration.** Learning and scoring repeat until no new substitution appears, so
   partial renames inside child values are covered too.
6. **Near-ties.** A near-tie stays unpaired, except when every child is identical: those
   siblings pair by name and then by ordinal position, so index-ordered containers such
   as `PDU_01`…`PDU_04` stay aligned.
7. **Children of a pair.** Compare children by their final id segment, so a changed owner
   name does not turn every child into an add + remove pair.

## Budget and fallback

- A comparison has a deterministic **candidate/scored-pair budget** shared by every bucket
  in one document (`SEMANTIC_SCORE_BUDGET = 250_000`). When the budget is reached, the
  pairs already found stay visible and `semanticLimitReason = 'budget'` is set.
- Above `SEMANTIC_PAIR_LIMIT = 250_000` candidate pairs in one definition group, a linear
  name/position fallback runs instead of the full score. When it cannot pair containers,
  `semanticLimitReason = 'fallback'` plus the skipped count is set.
- The two cases use different notices above the rows so a user can tell them apart.
- The budget is a candidate count, not a wall-clock cutoff: the same files produce the
  same result on every run.
- Strict mode reproduces the strict output exactly. A near-tie or budget-limited group
  stays unpaired in Strict.

## Benchmark guards

`src/test/benchmarks/diffSemanticBenchmark.ts` is the regression evidence for the
bucket-product cut-off:

- Corpus A: ten 100-container buckets plus one 500×400 bucket, all above the rename
  threshold; it must pair containers and finish within a **3 s** ceiling and a 512 MiB
  retained-memory ceiling.
- Corpus B: 200 containers whose children embed the container name (the deadlock shape);
  it must pair at least 200 and stay within the same 3 s ceiling.

The 250k cut-off is the real guard: without it, corpus A takes many seconds. The
benchmark is evidence, not a promise for a different machine.

## Must / must not

- **Must** keep the budget deterministic and independent of iteration order or timing.
- **Must** expose the limit reason and the unmatched count to the page notice.
- **Must** keep Strict and Semantic views reproducible from the same prepared rows.
- **Must not** pair across different `DEFINITION-REF`s or different parents.
- **Must not** apply semantic pairing to parameters or references.
- **Must not** re-scan either file when only the match mode changes.
- **Must not** turn a rename into a visible badge, dashed underline or count; a semantic
  pair renders exactly like a changed row.

## Tests Required

- `src/test/core/planDiff.test.ts` — DIFF-01/03/04 from
  [`docs/contributor/TEST_PLAN.md`](../../../docs/contributor/TEST_PLAN.md).
- `src/test/benchmarks/diffSemanticBenchmark.ts` — the budget/cut-off guard.
- `src/test/benchmarks/diffToggleBenchmark.ts` — toggling reuses the prepared rows.
- The diff page/preview states that exercise renamed containers and the mode spinner.
