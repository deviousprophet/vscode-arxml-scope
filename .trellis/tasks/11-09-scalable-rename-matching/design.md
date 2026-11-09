# Technical design — scalable rename matching

## 1. Evidence and boundaries

The measured baseline and claim-by-claim review are in
`research/00-plan-and-rust-review.md`. The short version:

- The semantic matcher is O(n²) per definition bucket and calls expensive per-pair work
  (`childrenScore` builds multisets, `nameScore` runs Levenshtein).
- At 500 containers the current code pairs all 500 in ≈16 s locally. At 700 the bucket is
  above `SEMANTIC_PAIR_LIMIT` (250,000) and the fallback pairs 0 because no substitution is
  learned before the fallback.
- The index is 54 MiB → 73 MiB retained; validation is a full pass but already sliced to
  a 17 ms longest slice. Rust is not the next-release fix.
- The extension host is Node-only today; a WASM "universal VSIX" is not a current fact.

This design keeps the work inside the existing pure core and the existing diff protocol.
No new runtime dependency, no `vscode` import under `src/core/**`, no persisted cache.

## 2. Files and ownership

| Area | File | Change |
|---|---|---|
| Matcher | `src/core/diff/diffModel.ts` | Signatures, candidate blocking, budget, learning, notice metrics |
| Diff session | `src/core/diff/diffSession.ts` | Reuse the same options/result; no cache contract change expected |
| Diff protocol | `src/diffProtocol.ts` | Optional limited-reason field on the document payload |
| Webview | `src/webview/diffViewer.ts`, `src/webview/components/diffView/diffViewRender.ts` | Read the reason, extend the existing note |
| Reverse map | `src/core/index/workspaceIndex.ts` | Conditional delta/invalidation; otherwise record the measurement |
| Contributor | `package.json`, `.nvmrc`, `README.md` | Node/npm requirement |
| Docs | `docs/DIFF.md`, `CHANGELOG.md` | Behavior and release note |
| Tests | `src/test/core/diffModel.test.ts`, new focused matcher tests, `src/test/webview/**` | Branch-level tests and notice rendering |
| Benchmarks | `src/test/benchmarks/renameScaleBenchmark.ts` (new) | 500/700 corpus and gates |

The existing `buildDiffDocument`, `DiffSession`, `DiffDocument` and `diffViewer` seams stay
in place. The matcher is an internal change to `diffModel.ts`, not a new subsystem.

## 3. Matcher design

### 3.1 Per-container precomputation

Before candidate generation, build one `SemanticNode` per leftover module/container:

```ts
interface SemanticNode {
  tree: TreeRow;
  index: number;                 // position in the bucket, stable
  name: string;
  nameLower: string;
  tokens: readonly string[];
  signature: string;             // lower-case, digits → '#', substitutions applied
  childKeys: ReadonlyMap<string, number>; // childKey -> count, substitutions applied
  childKeyHash: number;          // order-independent hash of childKeys
  childBlob: string;             // built once for substitutionScore
}
```

`childKeys` is the same multiset `childrenScore` builds today. It is computed once per node
per scoring pass, not once per pair. When `context.substitutions` changes, rebuild the
signature/child-key fields for the affected bucket; the number of learning passes is
bounded (existing initial pass + name-learning pass + at most three refinement passes), so
this remains O(passes × nodes × children), not O(n²).

`tokens` uses the existing `tokensOf`; keep the raw tokens for learning. `signature` uses
the existing substitution/name normalization plus digit collapse (`0..9+` → `#`) so
`NM_MO_42` and `NM_MO_43` share a signature while the ordinal is still available for
position pairing.

### 3.2 Candidate generation

Run the existing strict passes first. Semantic candidates are generated only for the
leftovers, as today. For each `(parent, kind, definitionRef)` bucket:

1. **Exact signature groups.** Group by `signature`. A 1:1 group is a direct candidate. An
   equal-size group (>1) is paired deterministically by ordinal/`index`, after a cheap
   child-key compatibility check. This is the bulk-rename path: after the substitution is
   learned, all `NM_MO_#` names share the signature.
2. **Child-key groups.** Group by `childKeyHash`; a same-hash pair is a strong candidate
   even when the names differ. Check the multiset equality on the shortlist; a hash
   collision must not create a pair.
3. **Rare-token inverted index.** Build `token -> nodes` for each side. Exclude tokens
   with document frequency above `max(64, 5% of the bucket)` and tokens shorter than 2
   characters. Add candidates that share at least one rare token. Rank by token Jaccard
   and take at most `MAX_CANDIDATES_PER_NODE` (proposed 48), deterministic by
   `relativeId` as the last tie-break.
4. **Bounded nearest fallback.** If a node has no candidate, take at most the same
   `MAX_CANDIDATES_PER_NODE` by cheap prefix/trigram similarity inside the bucket. This
   preserves the current behavior for awkward names without scanning the whole bucket.

Candidate collection is deduplicated by `(left, right)` and capped by a deterministic
`MAX_TOTAL_CANDIDATES` per bucket (proposed 50,000) and a document-wide budget (proposed
250,000). The cap is a count of evaluations, not a time. The score function is only called
on the resulting shortlist.

Do not use "shares any token" alone: in the E5 corpus every name shares `MO`, so that
filter leaves the full product.

### 3.3 Scoring

Keep the existing weights and thresholds:

- children 0.55, name 0.30, position 0.10, substitution 0.05;
- accept at `SEMANTIC_SCORE_FLOOR = 0.62`;
- near-tie margin `SEMANTIC_MARGIN = 0.08`;
- `SEMANTIC_LEARN_SCORE = 0.62`, `SEMANTIC_NAME_SEED_FLOOR = 0.55`.

`scoreSemantic` reads the precomputed node fields. Levenshtein runs only for shortlisted
candidates. Keep the full length-aware Levenshtein (or an early-exit bounded variant only
if tests prove identical results); do not replace it with a different similarity measure
without a threshold/regression review.

The top-two margin is computed over evaluated candidates. Candidate generation must
therefore include the nearest alternatives (same signature, same child hash, rare-token
peers), so a shortlist cannot manufacture certainty. A focused test covers a near-tie
where both alternatives are in the shortlist.

### 3.4 Substitution learning

Replace the O(n²) `learnNameSubstitutions` scan with an inverted-index pass:

1. Build token postings for both sides (raw tokens, after the current substitutions).
2. For each left node, collect right nodes sharing a rare token. Rank by token Jaccard and
   take a small deterministic top-K.
3. Keep mutual-best pairs. Gate them with the full `nameScore` (as today) and the seed
   floor.
4. Feed the seeds to the existing linear `learnSubstitutions`; keep the confidence and
   single-token rules.
5. Rebuild the bucket signatures and rescore. Repeat at most the existing bounded number
   of passes.

The digit token is intentionally not suppressed by the rare-token rule: `NM_MO_42` and
`NMH_MO_42` share `42`, which is a cheap 1:1 seed. High-frequency tokens such as `MO` are
suppressed only when they would create the full product.

If the bucket is above the old pair limit, still run this learning before the name-key
fallback. The fallback remains a last resort; with E1/E2 it should be rare. Record the
fallback count and reason.

### 3.5 Deterministic budget and limited state

Use two layers:

- **Primary: work budget.** Count candidate evaluations and scored pairs. Defaults:
  `SEMANTIC_MAX_CANDIDATES_PER_NODE = 48`, `SEMANTIC_MAX_TOTAL_CANDIDATES = 50_000`,
  `SEMANTIC_SCORE_BUDGET = 250_000`. These are deterministic for the same input and bucket
  order. When hit, keep the pairs already accepted and stop rescoring that bucket.
- **No wall-clock limit in this scope.** The deterministic work budget is the only limit.
  A future watchdog would need a new reason in `SemanticLimitReason`, a producer and a
  test; do not add an unreachable branch.
- **Test-only override.** `DiffOptions.semanticPairBudget` exposes the scored-pair budget
  so a test can exercise the limited branch; host code must not set it.

The existing `SEMANTIC_PAIR_LIMIT = 250_000` is the fallback threshold. Keep it as a
compatibility safety, but the new candidate budget should make it rare. Document the
relationship in `docs/DIFF.md`.

The document carries:

```ts
interface DiffDocument {
  // existing fields...
  /** Existing count: containers the fallback could not pair. */
  semanticSkipped: number;
  /** Optional reason for a limited comparison; absent means no limit. */
  semanticLimitReason?: 'budget' | 'fallback';
}
```

If both fallback and budget limits occur, prefer the reason that affected the most nodes
and keep `semanticSkipped` as the total unpaired count. The webview shows a generic
message for an old payload with only `semanticSkipped`, and a reason-specific message when
the new field is present. This is backward-compatible with the current-release page/protocol tests.

### 3.6 Identical children

`assignIdenticalChildren` is also O(n²) today. Replace its inner loop with the same
signature/index grouping:

- group by normalized name (digits collapsed) and child-key identity;
- pair equal-signature groups by ordinal;
- pair the remaining equal-size groups by position;
- keep the existing deterministic sort and the "all children identical" precondition.

This branch already exists only when every candidate's children score is ≥0.99; preserve
that condition so the fallback cannot steal pairs from the normal scorer.

### 3.7 Complexity target

For a consistent bulk rename with unique ordinals, candidate generation is O(n) expected:
each name has a rare ordinal token, signature groups are 1:1, and the shortlist is small.
For a bucket with no distinguishable tokens, the budget caps the work and the fallback
pairs by name key. The target is near-linear in the first case, bounded in the second; the
benchmark is the proof, not the claim.

## 4. Reverse-reference map (E6, conditional)

### 4.1 Current behavior

`WorkspaceIndex.ensureReferenceMap()` builds `referencesByTarget` by resolving every
reference in every file. It caches by `generation`, which every `upsert`/`remove` bumps.
`referencesFor()` is lazy, so the cost is paid on the first Find References after a change.

### 4.2 Decision gate

Before changing the data structure, add a measurement on a real 42 MB-class workspace (or
the closest synthetic equivalent with realistic path shapes) that records:

- time for a full rebuild after one file upsert;
- number of references, files and duplicate/suffix cases;
- peak memory during the rebuild.

If the rebuild is below the agreed threshold (proposed 100 ms), record the number and defer
E6 with a note in `docs/DIFF.md`/the task. If it is above, implement the delta design below.

### 4.3 Delta design

Maintain two indexes:

```ts
// target identity -> references that resolve to it
referencesByTarget: Map<string, IndexReference[]>;
// source file -> target keys that file contributed
targetsBySourceFile: Map<string, Set<string>>;
// raw target text -> source files, for invalidation
sourcesByRawTarget: Map<string, Set<string>>;
```

On `upsert(file)` or `remove(file)`:

1. Remove that source file's old references from `referencesByTarget` using
   `targetsBySourceFile`, and remove its raw-target entries.
2. Re-resolve the file's new references and add them.
3. If the file's elements/definitions changed, references in **other** files may resolve
   differently. Build a dirty set from the old and new element/definition path keys and
   their last-segment/suffix forms; for each dirty raw target, re-resolve the contributing
   source files and replace their entries. If a change can affect a unique-suffix match
   ambiguously, invalidate the whole map (the existing behavior) rather than guess.
4. Bump the generation and keep the cache consistent.

Tests must cover: add a definition, remove a definition, retarget an element, create an
ambiguous suffix, and a split-copy/duplicate element. A stale entry is a correctness bug,
not just a performance bug.

If the invalidation logic cannot be made obviously correct without scanning all references,
the full rebuild is the safer answer; the gate exists to avoid adding complexity for an
unmeasured 390 ms.

## 5. Contributor setup

- `package.json`: add `engines.npm: ">=11"` and `engines.node: ">=24"`; optionally
  `packageManager: "npm@11"`.
- `.nvmrc`: `24`.
- `.npmrc`: consider `engine-strict=true` so npm 10 fails on the `engines` check with a
  clear message instead of the lockfile error. Verify npm 11 and 12 both pass and the CI
  Node 24 job still passes.
- `README.md`: add a short "Contributing" prerequisite block: Node 24, npm 11+, `npm ci`,
  `npm run compile`, `npm test`, `npm run benchmark`.
- CI already uses Node 24; no version matrix change is needed. Add a version print only if
  it helps diagnosis.

Do not regenerate the lockfile with an older npm as a workaround. The project should
declare the supported toolchain, not silently produce a lockfile that half the toolchain
cannot read.

## 6. Webview and protocol

- Extend `DiffDocument` with the optional `semanticLimitReason`.
- Update `diffViewer.setDocument` to read the reason and change the existing
  `diff-semantic-skip` text:
  - fallback: `N containers in a large group could not be matched semantically.`
  - budget: `N containers were left unmatched because the comparison reached its work
    budget.`
- Keep the note above the rows; if the toolbar is chosen, add a compact status next to the
  Semantic/Strict group rather than a second notice region. Do not rebuild the panel
  chrome; `diffViewer` keeps the element reference.
- Existing payloads without the reason keep the current-release wording. Add a webview test for
  each reason and for the missing-field fallback.

## 7. Rollout and rollback

- No persisted data or migration. The change is runtime-only.
- `arxmlScope.diff.semanticMatching` remains default `true`; Strict is the user's escape
  hatch and must remain byte-for-byte equivalent to the strict builder.
- If a blocking bug is found in the field, the rollback is a revert of the matcher commit;
  the existing `DiffSession` cache and `buildDiffDocument` signature do not change, so the
  revert is self-contained.
- The budget is additive; a rollback that leaves the optional protocol field in
  place is harmless because the webview treats it as optional.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Blocking misses a valid pair | Signature/child-hash/rare-token shortlist plus a bounded nearest fallback; near-tie and realistic fixtures; full existing suite |
| Budget changes output between runs | Deterministic evaluation counts; no wall-clock limit; tests assert exact counts |
| E6 delta goes stale | Dirty-target invalidation; full invalidation for ambiguity; add/remove/retarget/suffix tests; gate on real measurement |
| Threshold change masks a regression | Keep weights/floor/margin; any change needs a measured reason and a test |
| npm tightening blocks contributors | `engines` + README + CI check; verify npm 11/12; document npm 10 failure |
| Rust scope creep | Explicitly out of scope; the Rust core-engine child task with end-to-end gates |
| Benchmark flakiness | State CI baseline, use a tolerance with a measured reason, measure memory as well as time |
