# Design — semantic rename matching in the diff

## Boundaries

| Layer | Files | Change |
|---|---|---|
| Pure diff | `src/core/diff/diffModel.ts` | relative child keys, semantic pass, scoring, substitution learner, `match` descriptor, `renamed` summary |
| Pure diff | `src/core/diff/wordDiff.ts` | unchanged; reused by the page |
| Protocol | `src/diffProtocol.ts` | match-mode messages and the mode on the document payload |
| Host | `src/host/diffPanel.ts` | setting read, mode state, rebuild on toggle |
| Webview | `src/webview/diffViewer.ts` | badge, rename-implied styling, toolbar toggle, summary |
| Webview | `src/webview/components/toolbar/toolbar.ts` / `toolbar.css` | toggle button and summary slot |
| Webview | `src/webview/components/diffView/diffView.css` | badge and rename-implied treatment |
| Manifest | `package.json` | `arxmlScope.diff.semanticMatching` |
| Benchmark | `src/test/benchmarks/diffSemanticBenchmark.ts` (new) | many-leftover budget |

## 1. Data model

```ts
export interface DiffMatch {
	kind: 'identity' | 'semantic';
	/** 0..1; identity pairs are not emitted today. */
	score: number;
	reasons: { children: number; name: number; position: number; substitution: number };
	/** Learned token changes used by this pair, e.g. ["NMH→NM"]. */
	substitutions?: string[];
}

export interface DiffRow {
	// ...existing
	match?: DiffMatch;
}

export interface DiffChange {
	// ...existing
	/** True when the two texts differ only by a learned rename substitution. */
	renameImplied?: boolean;
}

export interface DiffSummary {
	changed: number;
	added: number;
	removed: number;
	unchanged: number;
	/** Subset of `changed` rows produced by the semantic pass. */
	renamed: number;
}

export interface DiffOptions {
	semanticMatching?: boolean; // default false in the core; host passes the setting
}
```

`DiffSummary.renamed` is a subset of `changed` (a semantic pair is still a changed row).

## 2. Relative child identity (B3)

`baseId` only strips `#<ordinal>`, and an id embeds the parent's name (`container:A#0/param:P#0`).
Add:

```ts
function relativeId(id: string): string {
	const at = id.indexOf('/');
	return at < 0 ? id : id.slice(at + 1);   // everything below the parent segment
}
```

`pairLevel` takes a context:

```ts
interface PairContext {
	relative: boolean;        // children of a semantic pair
	semantic: boolean;        // setting/toggle
	substitutions: ReadonlyMap<string, string>;
}

function pairLevel(left, right, context): Map<TreeRow, TreeRow>
function mergeChildren(left, right, leftRanges, rightRanges, context): MergedNode[]
```

In `relative` mode every identity key uses `baseId(relativeId(row.id))`: the base-id grouping and the
exact-id pass. `contentIdentity`, `subtreeIdentity` and `sortIdentity` are already id-free, so the
existing identity passes keep working inside a renamed parent. A normal pair passes `relative: false`,
which reproduces today's ids exactly.

`pairedNode` forwards `context.relative` to `mergeChildren` for its children; a semantic pair sets
`relative: true` and keeps `semantic: true`, so nested containers get the same pass recursively.

## 3. Semantic pass (B1, B4, B5)

Runs inside `pairLevel` after the existing passes and only when `context.semantic` is true.

### 3.1 Candidates

- Leftover left rows with `row.kind === 'container'` and leftover right rows with the same `kind`.
- Same `definitionRef` (exact string). Different `DEFINITION-REF` never pairs.
- Same parent by construction: `pairLevel` is per parent. A container moved to another parent is never
  a candidate.
- Bucket key: `kind + '\u0000' + definitionRef`. One bucket per parent level.

### 3.2 Score

```
score = 0.55 * children + 0.30 * name + 0.10 * position + 0.05 * substitution
```

| Term | Definition |
|---|---|
| `children` | Multiset Jaccard of the two children's relative keys after substitutions. Child key = `kind|definitionRef|sortIdentity`. Both sides empty → 1; exactly one empty → 0. |
| `name` | `0.5 * tokenJaccard(leftName, rightName) + 0.5 * (1 - levenshtein / maxLen)`, after substitutions. Tokenizer `/[A-Za-z0-9]+/`, case-insensitive; zero-length names score 0. |
| `position` | `1 - |i - j| / max(1, max(siblingCountLeft, siblingCountRight))`, clamped to 0..1, using original sibling indices. |
| `substitution` | 1 when `applySubstitutions(leftName) === rightName` (or the names differ only in learned tokens); 0.5 when a learned old token occurs in either name or in a changed child text; 0 otherwise. |

Weights sum to 1.00. A pair must clear **score ≥ 0.62** to be considered.

### 3.3 Near-tie rule

For a candidate pair to be accepted it must also be the unique best on **both** sides:

- best score ≥ 0.62;
- `best − secondBest ≥ 0.08` for that left row and for that right row.

If either margin fails, both rows stay removed/added. This is what keeps two near-equal siblings
(`Container_1` vs `Container_2`) from pairing.

### 3.4 Assignment

- Enumerate all candidate pairs in the bucket.
- Sort by `score` desc, then left relative id, then right relative id (deterministic).
- Greedy one-to-one: take a pair when neither side is used and both margins pass.
- Because candidates are bucketed by `kind` + `definitionRef`, buckets are small; the greedy pass is
  the global best available pair at each step and deterministic. A full Hungarian assignment is not
  needed for the one-candidate case and would obscure the near-tie rule.

Declaration order independence: relative ids end in `#<ordinal>` from the scan, but the identity passes
already pair duplicate groups by content; the semantic pass only sees leftovers and sorts by
`baseId(relativeId)` before scoring, so a reordered declaration set produces the same assignment.

### 3.5 Learned rename substitution (B4)

A substitution is a token pair `old → new` inferred from accepted pairs.

1. **Seed pass.** Score the bucket once without substitutions. Keep accepted pairs with
   `score ≥ 0.80` and different short names.
2. **Token diff per seed.** Tokenize both names; align by longest common subsequence; record each
   aligned position whose tokens differ.
3. **Frequency gate.** A substitution enters the map when it occurs in at least **2** seed pairs and
   at least **60%** of the seeds that contain `old` agree on the same `new`. Skip tokens shorter than
   2 characters and pure-digit tokens.
4. **Conflicts.** Sort by count desc, then `old` lexicographically; the first mapping for an `old`
   token wins.
5. **Second pass.** Rerun the bucket with the map applied to child keys and names; accept the final
   assignment. This can only raise a pair that was already the unique best; it never creates a pair
   below the threshold.

The map is document-global and accumulated in traversal order (left to right, depth first). A pair
accepted at a higher level therefore raises confidence for its descendants, which is the batch effect
the brief asks for (`NMH` → `NM` across many containers).

`applySubstitutions(text, map)` replaces whole identifier tokens (`/([A-Za-z0-9]+)/`), case-sensitive,
longest old token first. It is used for scoring and for `renameImplied`; it never rewrites displayed
text.

## 4. Rename-implied changes (B6)

For a semantic pair, `diffChanges` still reports every differing field. Add a post-pass:

```ts
for (const change of changes) {
	if (applySubstitutions(change.left, map) === change.right) {
		change.renameImplied = true;
	}
}
```

`short name` changes that are fully explained by the substitution get the flag too; the container row
keeps `status: 'changed'` and its word-level diff. The page renders flagged word runs with
`.rename-implied` (dashed underline + 55% background opacity) and a tooltip
`Changed by the inferred rename "NMH" → "NM"`. Independent edits keep the normal changed style.

## 5. UI and protocol (B7, B8)

### 5.1 Protocol (`src/diffProtocol.ts`)

```ts
// host → page
| { type: 'document'; document: DiffDocument; semantic: boolean }
// page → host
| { type: 'matchMode'; semantic: boolean }
```

`DiffPanel` reads `arxmlScope.diff.semanticMatching` (default `true`) at open, keeps `semantic` in a
mutable variable, includes it in every `document` post, and on `matchMode` sets it and calls the
existing `refreshNow()`. The toggle is panel-scoped and never writes configuration.

### 5.2 Toolbar

`DiffToolbarCallbacks` gains `onMatchMode?(semantic: boolean)`. `renderDiffToolbarHtml` adds one button
in `.toolbar-left`:

```html
<button id="diff-match-mode" class="tool view-tool" type="button" aria-pressed="true">
  <span class="lbl">Semantic</span>
</button>
```

`setMatchMode(semantic)` sets `aria-pressed` and the label (`Semantic` / `Strict`). The page calls it
from the `document` message and forwards clicks with the next boolean.

### 5.3 Row marker

`renderRow` adds, for `row.match?.kind === 'semantic'`, a `<span class="diff-match-badge">renamed</span>`
next to the label. `title` = `Renamed (score 0.83) — children 0.9, name 0.8, position 1.0, substitution
NMH→NM`. It is decorative, so the accessible name stays the row text; the badge is not a separate
focus target.

### 5.4 Summary

Add a `<span class="diff-summary">` slot to the toolbar's right group and update it from
`diffDocument.summary`:

```
12 changed (9 renamed) · 3 added · 1 removed
```

Zero parts may be omitted, but `renamed` follows `changed` whenever it is non-zero. Counts, Prev/Next
(`nextChangeIndex` already skips `unchanged`) and `diffVisibility` need no new logic: a semantic pair is
`changed`.

## 6. Performance (B9)

- Candidates are bucketed by parent (per `pairLevel`), kind and `DEFINITION-REF`; no cross-bucket
  comparisons.
- Scoring is O(L × R) per bucket. Hard guard: when `L * R > 250_000`, skip the semantic pass for that
  bucket (rows stay removed + added) instead of stalling the panel. Deterministic and bounded.
- Budget: 2,000 leftover containers across the document, with a worst bucket of 500 × 400, in
  **≤ 1,500 ms**; `diffSemanticBenchmark.ts` asserts it and prints time, heap and the paired count.
- The pass runs only on `buildDiffDocument`, which the panel already debounces (150 ms) and
  generation-guards.

## 7. Determinism

- Candidate enumeration follows the input arrays; sorting uses score, then relative id strings, so the
  same rows give the same assignment.
- The substitution map is ordered by count desc, then token text.
- No `Map` iteration order is relied on for output: buckets are keyed by definitionRef strings and the
  merged output follows the left order plus the existing right-only queue.
- A test runs the same fixture twice and reversed declaration order, asserting identical row keys and
  statuses.

## 8. Compatibility and rollback

- Semantic matching is additive and gated. `semanticMatching: false` (setting off or toggle) returns the
  exact current output; the existing `diffModel.test.ts` expectations remain the strict baseline.
- `DiffSummary.renamed` is additive; the page and the ECUC benchmark fall back to 0 when absent.
- `DiffRow.match` is optional; no other consumer requires it.
- Rollback: remove the option, the pass and the protocol field; the payload and page still render.

## 9. Risks

| Risk | Mitigation |
|---|---|
| A rename pairs two different containers | Same parent + kind + `DEFINITION-REF` gate; score threshold; 0.08 margin; ties stay removed/added |
| Learned substitution over-fits | Requires ≥ 2 seeds and ≥ 60% agreement; only identifier tokens; scoring still requires the threshold |
| Child alignment shifts a real edit | Relative keys compare kind/definition/value; a genuinely changed child stays `changed` and is not rename-implied |
| Toolbar toggle confuses the summary | Summary always reflects the current document; strict mode shows `renamed: 0` |
| Large buckets stall the panel | Bucket product guard at 250,000, benchmark budget 1,500 ms |
| Strict mode drifts | Regression test compares strict output with the pre-change fixtures; the semantic branch is the only gate |
| Badge clutters rows | Small text marker with a tooltip; only semantic pairs carry it |

## 10. Shared release

Version bump, changelog, README/docs, spec update and the full verification list are owned by
`.trellis/tasks/11-04-validation-false-positives/implement.md` section 8. This task adds the
`arxmlScope.diff.semanticMatching` line to that changelog entry and to `README.md`.
