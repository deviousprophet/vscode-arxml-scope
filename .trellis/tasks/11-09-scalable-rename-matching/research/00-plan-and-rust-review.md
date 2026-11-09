# Plan and Rust proposal - evidence review

Date: 2026-11-09

Sources checked:

- `H:\workspace\ARXML_EXTENSION_FEATURE_PLAN.md`
- The external agent's Rust analysis (quoted in the task request)
- Repository at `606204e` (the current release)
- `src/core/diff/diffModel.ts`, `src/core/index/**`, `src/core/validation/**`,
  `src/host/**`, `src/webview/diffViewer.ts`, `package.json`, `.github/workflows/**`

Method: read the implementation, then run the checked-in benchmarks and two temporary
probes. The probes were removed after measurement; the numbers below are reproducible from
the shapes described here.

Local environment: Windows, Node `v24.22.2`, npm `12.1.0`. Absolute timings vary by
machine; the scaling shape and the paired/skipped counts are the important evidence.

## 1. Measured baseline

### Rename matching at scale (temporary probe)

Shape: one root, one definition group, `N` renamed containers, each with 25 parameter
children whose values embed the old container name. Left prefix `NMH`, right prefix `NM`;
same shape as plan item E5.

| Renamed containers | Paired | Changed rows | Added | Removed | Semantic skipped | Time |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 100 | 2,600 | 0 | 0 | 0 | 688 ms |
| 200 | 200 | 5,200 | 0 | 0 | 0 | 2,596 ms |
| 500 | 500 | 13,000 | 0 | 0 | 0 | 16,163 ms |
| 700 | 0 | 0 | 18,200 | 18,200 | 1,400 | 24 ms |

This reproduces the reported behavior:

- Cost is quadratic through 500. The external agent measured 1.2 s / 5 s / 32 s; this
  machine is roughly 2x faster, but the curve is the same.
- The 500 case sits exactly at the `SEMANTIC_PAIR_LIMIT` boundary
  (`500 * 500 = 250,000`, and the test is `> 250,000`), so the full O(n²) scorer runs.
- At 700 the bucket is oversized (`490,000 > 250,000`), the linear fallback runs before any
  substitution can be learned, and it pairs nothing: all 700 containers become add/remove
  pairs. The 24 ms is the cost of failing fast, not a good result.

### Checked-in benchmarks (`npm run benchmark`)

| Benchmark | Workload | Result |
|---|---|---|
| `diffSemantic` | 6,022 source rows, 1,500 renamed | 620 ms, 2 MiB retained |
| `diffSemantic` embedded | 4,400 rows, 200 renamed with embedded names | 1,116 ms, 2 MiB |
| `diffToggle` | 4,422 rows, 1,100 renamed | semantic first 222 ms, strict first 5 ms, cached 0 ms |
| ECUC scan | 26 MiB, 73,884 records | 238 ms, 79 MiB retained |
| ECUC rows | same model | 268 ms, 41 MiB retained |
| ECUC diff | 52 MiB combined, 978 changed/added/removed | 316 ms, 49 MiB retained |
| Index build | 54 MiB, 217,801 records | 1,408 ms (≈39 MiB/s), 73 MiB retained |
| Index lookup | warm | 14 ms, 1 MiB |
| Index upsert one file | 216k-element workspace | 0 ms in the synthetic check |
| Validation | 36 MiB, 220,042 records, 11,011 diagnostics | 681 ms, 5 MiB retained |
| Validation slices | same workspace | 1,236 slices, longest 17 ms, 566 ms total |

The index-build and validation figures are close to the external analysis; the absolute
times are lower on this machine, while retained memory matches (73 MiB for the 54 MiB
index). The external "1.4–1.8 s validation" is conservative, not contradicted.

### Reverse-reference map probe (temporary probe)

Synthetic `WorkspaceIndex` with 1,000 references per file, all resolving to one target:

| References | Warm lookup | Full rebuild after one upsert |
|---:|---:|---:|
| 5,000 | 0 ms | 4 ms |
| 20,000 | 0 ms | 9 ms |
| 50,000 | 0 ms | 22 ms |

The mechanism is real: `WorkspaceIndex.ensureReferenceMap()` rebuilds the whole
`referencesByTarget` map whenever `generation` changes, and every `upsert`/`remove` bumps
it. `workspaceIndex.ts` deliberately keeps element/definition lookups incremental but
leaves the reverse map global.

The external claim of "about 390 ms at 42 MB" was **not reproduced**. This synthetic probe
does not include real path-resolution costs, duplicate suffixes, or the real file mix, so
the number may still be correct for a customer workspace. It is not evidence for the size
of the problem. E6 needs a real-corpus measurement before committing to the extra
invalidation complexity.

## 2. Verification of the Rust analysis

### Claims that hold

- **Rename matching is O(n²) and is the slowest measured area.** `assignSemantic()` builds
  every left × right pair, and every pair calls `scoreSemantic()`, which calls
  `childrenScore()`, `nameScore()`, `positionScore()` and `substitutionScore()`.
  `childrenScore()` rebuilds multisets of child keys on every call; `nameScore()` runs a
  full Levenshtein distance on every call. Precomputing the child multiset and token sets
  and blocking candidates is an algorithm win in any language.
- **Rust would not fix the oversized-bucket behavior.** At 700 the fallback pairs nothing
  before scoring at all; a 5–10x faster scorer changes nothing. E2 (learning before the
  fallback) and E1 (blocking) are the fixes.
- **Index build is CPU-bound and object-heavy.** 54 MiB → 73 MiB retained and 1.4–2.1 s
  depending on the machine. A compact flat/interned representation is the main
  opportunity, and Rust can express it well.
- **Validation is a full pass over index data.** `validateWorkspaceSlices()` iterates every
  file's elements, references and definitions on each index change. Incremental per-file
  validation would help more than a faster full pass.
- **`core/` is a clean seam.** Zero `vscode` imports under `src/core/**`; the benchmarks
  are headless and already cover index, scan, rows, diff and validation.
- **`npm ci` fails on npm 10.** Confirmed with `npx npm@10 ci --dry-run`:
  `Missing: ansi-regex@5.0.1 from lock file`. npm 11 and npm 12 both pass. The plan's E7
  is a real contributor bug, not a guess.
- **The webview and VS Code API glue are not the bottleneck.** The pure stages above
  dominate; the webview renders a viewport window.

### Claims that are wrong, unsupported, or need a caveat

1. **"420 tests" is not the current count.** A static count of `test(` / `it(` declarations
   is 563: 229 core, 142 extension, 191 webview and 1 root-level. Parameterized/compiled
   counts may differ at runtime, but 420 is not supported by the tree. Use the actual
   suite count when describing conformance.

2. **WASM does not automatically give "one universal VSIX" that "works in remote and
   web".** The extension is Node-only today: `package.json` has `main` and no `browser`
   entry; the extension bundle is `platform: 'node'`. The webview bundles are browser
   targets, but they are pages, not the extension host. A web build would need a separate
   browser entry, a `browser` field, API audits and a different WASM loader. Remote works
   because the extension host is Node, not because WASM is universal.

3. **The proposed Rust boundary is underspecified and may erase the gain.** "Text chunks
   in, `FileIndex` out" is only a win if `FileIndex` stays compact. Today `FileIndex` is
   arrays of JS objects with many strings, and every consumer (`WorkspaceIndex`,
   `definitions.ts`, validation, navigation, diff rows) expects those objects. If Rust
   returns JS objects, the allocation cost and most of the memory advantage return at the
   boundary. If Rust returns a compact binary layout, every consumer must be rewritten to
   read it. The prototype must measure the **end-to-end** result after materialization and
   consumer calls, not just the tokenizer.

4. **`memchr`/SIMD byte search is not the obvious win.** `XmlStreamParser` already uses
   `buffer.indexOf('<')`, which V8 optimizes heavily; the cost is parsing structure,
   string allocation and building records, not scanning bytes. A Rust tokenizer may be
   faster, but "several hundred MB/s" cannot be inferred from `memchr` throughput. Measure
   the complete index build, not a tokenizer microbenchmark.

5. **"Rust would be 5–10x faster at the same curve" is plausible but unmeasured.** Even
   with 5x, 500 containers would be ≈3.2 s on this machine (16.2 s / 5), which barely
   meets the proposed 3 s target, and 700 still pairs nothing. Rust cannot be the primary
   next-release fix.

6. **"Native addon = platform-specific VSIX builds" is too absolute.** `napi-rs` can ship
   prebuilt binaries through optional dependencies or per-platform packages. The real
   cost is VS Code's Electron/Node ABI matrix, download size, signing and CI; a universal
   VSIX becomes large and still needs every platform built. The conclusion (high
   maintenance cost) is right; the mechanism is more flexible than stated.

7. **"WASM has no easy multithreading" is fair but not absolute.** `wasm-bindgen-rayon`
   exists, but it needs `SharedArrayBuffer`, a worker pool, special bundling and a host
   that provides workers. The extension currently has no worker-thread layer at all.

8. **"390 ms reverse map" is unverified.** See the probe above. The design change may
   still be worthwhile, but the priority should follow a real measurement.

### Rust recommendation

Do not put Rust in the next release. The external analysis's own ordering is right: fix the
algorithm and the reverse-map/validation costs first. After the next release:

1. Try the compact-index/flat-array representation in TypeScript first. It is the same
   data-layout idea without a new toolchain, and it establishes whether the memory and
   speed gains come from layout or from Rust.
2. If that is insufficient, prototype Rust/WASM on the index builder with an **end-to-end**
   gate: text in, a representation the real consumers can use, retained heap after the
   boundary, 54 MiB case, package size and CI cost. A 5x time / 2x memory target is a
   reasonable starting gate, but it must include the consumer path.
3. Only then consider validation and the diff scorer. A native addon or sidecar belongs
   with the language-server extraction, not before it.

## 3. Review of the feature plan

The plan is directionally sound. The following items need correction before
implementation.

### E1 — candidate blocking

"Index each side by name tokens and score only candidates that share a token" does not
bound the E5 corpus. For `NMH_MO_0 … NMH_MO_499` versus `NM_MO_0 … NM_MO_499`, every name
shares the `MO` token and most share the normalized shape. Token sharing alone leaves
≈250,000 candidates. Blocking must also use:

- a normalized name signature (lower-case, digits collapsed, substitutions applied) and
- the child-key multiset, and
- a rare-token inverted index with high-frequency-token suppression, and
- deterministic ordinal pairing inside equal-signature groups.

Precompute the signature once per container per comparison. Score only the shortlist.
Call the result "near-linear" only after the 500/700 benchmark demonstrates it.

### E2 — oversized buckets learn substitutions

This is necessary for 700, but it must not be another O(n²) scan. Learn from an inverted
token index / mutual-best on rare tokens, apply digit normalization, and only then use the
name-key fallback. Keep the "never invent a pair" rule.

### E3 — time budget

A wall-clock budget makes diff output depend on machine load: the same two files could
pair differently on two runs. Use a **deterministic work budget** (candidate evaluations
or scored pairs) as the primary limit, with an optional wall-clock watchdog as a last
resort. When either limit is hit, keep the pairs already accepted, record the reason and
count, and report it. Tests must not assert a wall-clock threshold as correctness.

### E4 — visible notice

Partially shipped in the current release: `diffViewer.ts` already reads `semanticSkipped` and shows a
`diff-semantic-skip` note above the rows. `docs/DIFF.md` already documents the 250k
fallback and the note. E4 should be narrowed to:

- distinguish above-limit fallback leftovers from budget-limited work,
- show the count and reason in the toolbar/notice, and
- keep the payload path working.

Do not re-implement the existing note from scratch.

### E5 — tests and benchmark

Keep the 500/700 × 25-embedded-children shape, but state the hardware/CI baseline and
gate both time and memory. The local baseline is 16.2 s at 500 and 0 pairs at 700; the
external 32 s is a slower machine, not a different bug. Add a near-tie that must stay
unpaired. Each test must fail when its branch is removed.

### E6 — incremental reverse map

The full rebuild is confirmed, but the 390 ms figure is not. Before adding a two-level
map, measure `referencesFor` after an upsert on a real 42 MB workspace. If the rebuild is
small, defer E6. If it is large, design the invalidation carefully: adding/removing an
element can change how references **in other files** resolve (exact path, unique suffix,
ambiguous suffix), so a naive "replace this file's references" delta can go stale.
Tests must cover add, remove, retarget-to-ambiguous and split-copy cases.

### E7 — contributor setup

Confirmed. Add `engines.npm: ">=11"` and a Node 24 `.nvmrc`, document Node 24 / npm 11+ in
the README, and consider `packageManager` or `engine-strict=true` so npm 10 fails with a
clear message instead of a lockfile error. CI already uses Node 24.

### E8 — docs

Update the existing `docs/DIFF.md` sections rather than adding a second explanation. Add
the blocking, budget, reason and notice behavior, plus the measured limits.

### Missing from the plan

- A language/toolchain decision record for Rust. It is discussed in the external analysis
  but absent from the feature plan and the open decisions. Add "Rust/WASM: deferred until
  after the next release; spike gate" to the plan or a linked decision note.
- An explicit "no new runtime dependencies" constraint for the matcher. The repository's
  quality guidelines forbid new runtime dependencies in core.
- A note that worker threads are not currently used and are a separate change; moving the
  diff off the host thread is not free and may be unnecessary once E1–E3 land.

## 4. Bottom line

The external analysis is substantially correct on diagnosis and priority: rename matching
is an algorithm problem, the index/validation work is CPU/object-layout work, Rust is not
the next-release fix, and a prototype needs gates. Its unsupported test count, its universal
WASM claim, its underspecified Rust boundary and its unverified reverse-map number should
not be carried into the plan as facts.

The next-release plan should proceed with the revised E1–E8 scope. The Rust question should be a
separate, later spike after the algorithm and layout work, with an end-to-end gate.
