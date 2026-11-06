# Design — 0.8.0 semantic renames, index robustness and bounded scans

## 1. Verified review baseline

| Review claim | Code evidence | Status |
|---|---|---|
| Child-name deadlock | `childKey` includes parameter values and reference targets; `learnSubstitutions` only seeds from pairs ≥0.8; acceptance needs ≥0.62 | Confirmed |
| Identical siblings rejected | `assignSemantic` requires a 0.08 margin on both sides; equal scores give 0 | Confirmed |
| Silent 250k cutoff | `if (lefts.length * rights.length > 250_000) continue` | Confirmed |
| Tests miss embedded names | Semantic fixture children are `A=1`; benchmark parents have identical names | Confirmed |
| Text features lack a cap | `cached()` returns `oversized` above `arxmlScope.index.maxFileSizeMB` | **Incorrect** — cap exists, no debounce |
| Validation lacks a debounce | `ValidationService` schedules with 400 ms; caps exist | **Incorrect** — the gap is the synchronous pass |
| Find References linear | `referencesFor` resolves every reference on each call | Confirmed |
| UTF-8 only | `readFileIndex` uses `new TextDecoder('utf-8')` | Confirmed |
| Lookup rebuild | `ensureLookups` rebuilds both maps after every generation change | Confirmed |
| Rebuild race | In-flight `reindexFile` can `upsert` after `replaceAll`; `dirtyDuringBuild` only covers events fired while `building` | Confirmed |

## 2. Semantic matching

### 2.1 Pipeline

Replace the current seed → learn → rerun sequence with:

1. **Name seeds.** Inside each definition bucket, compute mutual-best pairs using `nameScore` alone
   (no child term). A seed is usable when the pair is mutual-best and the names are not identical.
2. **Learn.** Convert token changes from seeds into substitution candidates. A candidate must be a
   non-numeric token of length ≥2. For multiple seeds require at least two consistent occurrences and
   a 0.6 consistency ratio (the current rule). For a single mutual-best seed allow the candidate when
   name similarity is ≥0.55 and exactly one non-numeric token changed.
3. **Assign.** Run the existing scorer with the merged substitution map.
4. **Iterate.** Learn from accepted pairs (score ≥0.62) and reassign; stop when no new mapping
   appears or after three passes. Conflicting mappings keep the first, highest-consistency entry.
5. **Finalize.** Emit accepted pairs with reasons and the substitutions used.

The existing weighting stays: 0.55 children, 0.30 name, 0.10 position, 0.05 substitution. The
acceptance floor stays 0.62 for the normal path.

### 2.2 Identical children

When every candidate in a bucket has `childrenScore >= 0.99`, the normal margin rule cannot separate
them. Use a dedicated tie path:

- Rank by name similarity, then by absolute position difference.
- Accept the best pair when its name score is at least the second-best by 0.02 **or** its position is
  strictly closer; otherwise leave the pair unassigned.
- Consume pairs greedily in rank order; never reuse a left or right.
- Names that differ only in numeric tokens are considered the same name for this path, so
  `PDU_01`…`PDU_04` pair by position.

This path is only for near-identical children; normal buckets keep the 0.08 margin.

### 2.3 Single rename

The name seed for a single container needs no "two examples" rule. If the pair is mutual-best, the
only non-numeric token change is learned, and the rescored pair clears 0.62, it is accepted. If the
rescored pair still misses the floor, it stays unmatched rather than being forced.

### 2.4 Pair-limit fallback

Above 250,000 pairs:

- Group both sides by name after applying known substitutions.
- Pair unique matching names (one left, one right).
- Pair remaining same-name duplicates by ordinal position.
- Mark fallback matches with `fallback: true` in the match reasons so tests and the UI can
  distinguish them.
- If any container remains unpaired after the fallback, increment a `semanticSkipped` count on the
  diff document; the diff toolbar shows a one-line notice when the count is non-zero.

The fallback is O(n log n) and never builds the quadratic candidate matrix.

### 2.5 Data and protocol changes

- `DiffMatch` gains an optional `fallback?: boolean`.
- `DiffDocument` gains `semanticSkipped: number` (zero when no bucket is skipped).
- Strict mode (`semanticMatching: false`) does not run the semantic pass and keeps the current
  document shape, with `semanticSkipped: 0`.

## 3. Index correctness

### 3.1 Rebuild epoch (G5)

`IndexService` keeps a monotonically increasing `rebuildEpoch`.

- `runRebuild` increments the epoch before reading files.
- `reindexFile` captures the epoch when it starts a read.
- Before `index.upsert` or `index.remove`, if the captured epoch differs from the current epoch, drop
  the result and add the URI to `dirtyDuringBuild`.
- The rebuild drains `dirtyDuringBuild` after `replaceAll`, so the dropped file is re-read from the
  post-rebuild state.

No file can be written to the index with content older than the snapshot it was read against.

### 3.2 Encoding (G7)

Add a pure byte-decoder module used by `readFileIndex`:

1. Buffer the first chunk (up to 3 bytes).
2. Detect BOM: `EF BB BF` → UTF-8, `FF FE` → UTF-16LE, `FE FF` → UTF-16BE.
3. Without a BOM, read the XML declaration from the first 256 decoded bytes. Support the encodings
   Node's `TextDecoder` implements: `utf-8`, `utf-16le`, `utf-16be`, `iso-8859-1`, `windows-1252`.
4. Decode the remaining chunks with the selected decoder; a BOM split across chunks is buffered.
5. An unsupported or contradictory declaration returns `undefined`, and the file joins `skipped`
   with the reason reported in the status tooltip.

The pure module owns detection and returns `{ encoding, bytesToSkip }`; the host owns streams.

### 3.3 Incremental lookups (G8)

Replace the generation-based full rebuild with incremental maintenance:

- `PathLookup` gets `add(item, path)` and `remove(item, path)`.
- `WorkspaceIndex` stores each file's elements and definitions and applies the delta on upsert or
  remove.
- `replaceAll` and the initial state build the maps once.
- A failed incremental update falls back to a full rebuild and logs nothing user-visible.

The suffix keys are derived by the same `splitPath` routine, so exact and suffix lookups stay
consistent. A generation counter remains for cache invalidation, but no longer forces a rebuild.

### 3.4 Reverse-reference map (R10)

- `WorkspaceIndex` keeps `referencesByTarget: Map<string, IndexReference[]>` keyed by
  `file|start|end` of the resolved element.
- Build it lazily on first `referencesFor` call per generation.
- On a file upsert/remove, drop that file's contributions and rebuild the map lazily.
- `referencesFor(target)` reads the map; it never resolves the whole reference list.
- The map is invalidated by the same generation counter used by the lookups.

The map doubles reference memory in the worst case; the benchmark gate records retained MiB and
fails above the existing 512 MiB budget.

## 4. Bounded scans

### 4.1 Text features

- Extend `CachedDocument` with `symbols?: SymbolData[]` and `links?: vscode.DocumentLink[]`, computed
  on first use per document version.
- Keep the existing `maxBytes` cap and document it as the text-feature cap. No new setting unless the
  benchmark shows a 40 MB document still blocks; in that case add
  `arxmlScope.textFeatures.maxFileSizeMB` with a default that preserves today's limit.
- `provideReferences` keeps using the reverse map; hover and links reuse the cached model.

### 4.2 Validation

- Split the pure engine into a preparation step (global maps, element/reference lists) and a
  per-file rule step. The preparation keeps the cross-file context; the per-file step returns the
  diagnostics for one file.
- `ValidationService.refresh` becomes an async loop: prepare, then validate files in slices, yielding
  with `setImmediate` every 4 ms or 50 files, whichever comes first.
- A generation token captured at start cancels the run when the index changes; a new run replaces it.
- Diagnostics are collected in a local map and published once at the end, with the same caps and the
  same summary diagnostics.
- The status bar shows `$(sync~spin) ARXML Scope: validating…` while a run is active; it restores the
  index status when the run finishes or is cancelled.

No rule text, severity, cap or related-information behavior changes.

## 5. Release mechanics

- Version stays `0.7.0` during implementation. At release time, set `0.8.0` in `package.json` and both
  `package-lock.json` fields.
- `CHANGELOG.md` gets `## [0.8.0] - <date>` with `Changed` and `Fixed` entries; no internal benchmark
  or task notes.
- `docs/DIFF.md` documents name-first learning, identical-sibling pairing, the fallback notice and
  the unchanged Strict mode.
- `docs/ECUC_EDITOR.md` documents the text-feature cap and the asynchronous validation status.
- Tag `v0.8.0` only after merge and an explicit request.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Name-first seeds create false substitutions | Non-numeric length ≥2, consistency ratio, single-pair confidence floor, and Strict mode remains available |
| Identical-child tie path pairs unrelated containers | Only when all children score ≥0.99; name and position must agree; otherwise leave unpaired |
| Fallback hides reorderings | Position pairing only inside same-name duplicates above the limit; mark `fallback` and report the count |
| Incremental lookup drifts from the full build | Keep `buildLookup` as the reference and add a test that compares both after random upserts/removes |
| Reverse map memory growth | 512 MiB benchmark gate; per-file invalidation keeps it bounded |
| Async validation publishes stale diagnostics | Generation token cancels; publish only the winning run |
| Encoding detection misfires | BOM first, declaration second; unsupported encodings skip rather than guess |
| Scope too large for one branch | Phase gates below; each phase ends with tests and a benchmark before the next starts |

## 7. Verification

- Semantic fixtures: 25/20/15/10/5 unchanged children, single rename, identical siblings, fallback.
- Index: rebuild epoch test, BOM fixtures, random upsert/remove lookup equality.
- Benchmarks: lookup update, reverse references, 36 MB validation slices, semantic embedded-name
  corpus.
- Full suite, lint, compile, package and VSIX.
