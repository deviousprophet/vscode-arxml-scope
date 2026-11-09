# Reverse-reference map measurement and decision

## Question

E6 asks whether the full reverse-reference rebuild after a file save is material enough to
justify an incremental map with target-change invalidation.

## Evidence

The mechanism is confirmed in `src/core/index/workspaceIndex.ts`:
`ensureReferenceMap()` rebuilds the whole `referencesByTarget` map whenever `generation`
changes, and every `upsert`/`remove` bumps the generation. Element and definition lookups
are incremental; the reverse map is not.

A temporary synthetic probe built a `WorkspaceIndex` with one target and 1,000 references
per file, then measured a warm lookup and a rebuild after one small upsert:

| References | Warm lookup | Full rebuild after one upsert |
|---:|---:|---:|
| 5,000 | 0 ms | 4 ms |
| 20,000 | 0 ms | 9 ms |
| 50,000 | 0 ms | 22 ms |

A second probe used a 42 MB-class shape: 1,000 target containers, 100 reference files,
1,000 references per file (100,000 reference values, roughly 42 MB of values at ~400 bytes
per value). A warm lookup was 0 ms; the full rebuild after one small upsert was **75 ms**.
The probe builds `FileIndex` records directly, so it excludes XML parsing but includes the
path-resolution and map construction cost that E6 would change.

The probe uses direct `FileIndex` records, so it does not include real path-resolution
costs, duplicate suffixes or the real file mix. It is still far below the 390 ms figure in
the external review and below the proposed 100 ms gate.

## Decision

Defer E6 for this scope. The current full rebuild is lazy (paid on the first Find
References after a save) and the 42 MB-class synthetic measurement is 75 ms. Adding a
two-level map with dirty-target invalidation is a correctness risk: adding or removing an
element can change how references in other files resolve through exact paths, unique
suffixes and ambiguous suffixes.

Record a real-corpus number before revisiting E6. If a 42 MB-class workspace shows a
rebuild above 100 ms, implement the delta design in `design.md` §4 with tests for add,
remove, retarget, ambiguous suffix and split copies.
