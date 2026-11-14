# Test Plan

The regression plan for every feature in the extension. It is deliberately broader
than the current suites: each area lists what is covered today and the edge cases that
must be added. Use the IDs (`SCAN-01`, `MERGE-04`, …) in test names so a failure points
at the plan row.

## Layers and commands

| Layer | What it proves | Command |
|---|---|---|
| Core unit | pure scanner/model/rows/index/diff/merge logic | `npm test` (`src/test/core`) |
| Webview DOM | the bundled page, its components and the host↔page protocol in jsdom | `npm test` (`src/test/webview`) |
| Extension integration | real VS Code: panels, edits, undo, watchers, diagnostics | `npm test` (`src/test/extension`) |
| Rust core | parse, ids, rows, edit plans, merge index, digests | `cargo test --workspace` |
| Engine process | protocol, lifecycle, byte-for-byte row parity with the TS oracle | `npm run engine:smoke`, `npm run parity`, `npm run parity:rows` |
| Performance | ceilings and payload sizes on the 20–26 MiB fixtures | `npm run benchmark` |
| Local sample | a real private ARXML, never committed | `ARXML_SCOPE_SAMPLE=… npm run benchmark sampleFile` |

Run order for a change: `check-types` → `lint` → `cargo test`/`clippy`/`fmt` →
`npm test` → `parity:rows` → the area benchmarks.

## Regression gates

| Touched area | Must run |
|---|---|
| `core/ecuc/*` | core scanner/rows/order/validate suites, `parity:rows`, `ecucLargeFile`, `engineEdit` |
| `core/diff/*` | `diffModel` (43 tests), `wordDiff`, `diffSemantic`, `renameScale`, `diffPage` |
| `core/index/*`, `host/indexService` | `indexBuilder`, `workspaceIndex`, `index` (extension), `indexBenchmark`, `validation` |
| `host/ecucEdit`, `host/ecucStructureEdit` | `editing`, `structureEdit`, `rescan`, `planMerge` |
| `host/engine/*`, `rust/*` | `engine` suites, `engine:smoke`, `parity`, `parity:rows`, `engineEdit` |
| `webview/*` | page + component suites for the touched component, `protocol` |
| `commands.ts`, manifests | `activation`, `menus`, `compare`, `reveal` |
| copy modules | `planCopy`, `planMerge` (extension), `copyBenchmark` |

## SCAN — scanner and model

Covered: every fixture's expected model, SYSC-REF inline, DEST capture, ranges, CDATA
empty, namespace prefixes, layout independence, stray end tags.

| ID | Case | Expected |
|---|---|---|
| SCAN-01 | CRLF and lone-CR documents | ranges are UTF-16 offsets into the exact bytes; no `\r` swallowed into text |
| SCAN-02 | UTF-16LE/BE file with BOM (decoded by the index too) | same model as the UTF-8 twin |
| SCAN-03 | astral character before a value | value range lands on the same characters, not shifted by one |
| SCAN-04 | attribute containing `>` and `'`/`"` | tag end is quote-aware; the model keeps the attribute |
| SCAN-05 | CDATA with `]]` inside text and a `>` in content | section skipped, no stray range |
| SCAN-06 | `<VALUE/>`, `<VALUE></VALUE>`, `<VALUE> </VALUE>` | all three keep an empty display value and fall back to their element range for edits |
| SCAN-07 | 10,000-deep nesting | scans without stack overflow (iterative) |
| SCAN-08 | unknown, unterminated and out-of-range entities | decode leaves them verbatim, never throws |
| SCAN-09 | DOCTYPE with internal subset and `>` inside it | declaration skipped exactly once |
| SCAN-10 | two sibling containers with one SHORT-NAME | both captured, distinct ranges |

## ID — node identity

Covered: ordinal disambiguation, sort independence, stability across re-scan, rename
prediction.

| ID | Case | Expected |
|---|---|---|
| ID-01 | three duplicate siblings, middle one deleted | remaining ids keep their ordinals except the shifted one; next edit still resolves |
| ID-02 | rename to a sibling's name, then edit the renamed one | refused or resolves to the right node; never the sibling |
| ID-03 | ids across a `sort: declaration` change | identical |
| ID-04 | module id with a `|` or `#` in a short name | id round-trips and resolves |
| ID-05 | param under a renamed container | child ids follow the container id; predicted id matches after re-scan |

## ROW — rows and ordering

Covered: DFS order, subtree invariants, posinset, labels/meta, formats, haystack,
sort exceptions, conditional disable, references.

| ID | Case | Expected |
|---|---|---|
| ROW-01 | negative, `0x`, `0b`, 64-bit and padded values | Decimal/Hex/Binary formats exactly as legacy, no precision loss |
| ROW-02 | Boolean parameter with `TRUE`/`False` | valueKind boolean; formats none; shown bare |
| ROW-03 | empty container and container with only a reference | `empty` flag and subtreeSize correct |
| ROW-04 | module with no containers | module row `hasChildren:false`, `subtreeSize:0` |
| ROW-05 | reference with two context paths | `context` chip and contextPaths order |
| ROW-06 | annotation with label only, text only, neither | comment line rules match |
| ROW-07 | false condition on an ancestor and true on the child | child disabledBy `ancestor`, not `self` |
| ROW-08 | `sortExcept` tail inside a longer path | exception applies by tail only |
| ROW-09 | sort all with identical keys | stable, declaration order preserved |

## COND — SW-SYSCOND and conditions

Covered: precedence, three-valued logic, missing symbols, literals, tail lookup, caps,
tooltips.

| ID | Case | Expected |
|---|---|---|
| COND-01 | `!(A) && B` and `!A && B` | same result; unary binds tighter |
| COND-02 | `"1" == 1`, `true == 1` | string/boolean vs number is unknown, never equal; two numeric spellings compare as numbers |
| COND-03 | two constants with one tail | unresolved; the referenced symbol is listed once (candidate list is a known gap) |
| COND-04 | 200 entries + one more | the first 200 are kept and the rest are dropped (the notice is a known gap) |
| COND-05 | quoted value with escapes and an unterminated quote | escapes decoded; unterminated is a parse reason |
| COND-06 | condition text with a raw `&amp;` entity | decoded before evaluation |

## EDIT — value editing

Covered: numeric/textual, empty/self-closing, CDATA refusal, escaping, unchanged,
invalid, undo, CRLF, raw `>`, attribute `>`, stale region, engine fast path.

| ID | Case | Expected |
|---|---|---|
| EDIT-01 | same value edited twice in a row | second edit plans against shifted ranges and succeeds |
| EDIT-02 | edit at the very start/end of the file | offsets clamp, one WorkspaceEdit, no corruption |
| EDIT-03 | value containing `&`, `<`, `>`, quotes | written escaped once; row shows decoded text |
| EDIT-04 | value changed by an external editor between plan and write | refused, no partial write |
| EDIT-05 | engine fast path vs TypeScript fallback for the same edit | identical bytes and identical row |
| EDIT-06 | 20 rapid edits | no range drift; final file equals the last value |
| EDIT-07 | edit that makes the line longer than 10k | one line, no wrapping injected |
| EDIT-08 | undo/redo after an engine-path edit | restores bytes and rows |
| EDIT-09 | engine unavailable (no handle) | legacy path still edits, no error |
| EDIT-10 | edit with a UTF-16 surrogate pair in the value | offsets stay correct |

## FIELD — container short name and definition ref

Covered: inner-text replacement, grammar, unchanged, rename prediction, DEST preserved.

| ID | Case | Expected |
|---|---|---|
| FIELD-01 | rename to an existing sibling name | allowed at this layer, duplicate reported by validation after |
| FIELD-02 | definition-ref with hyphens/dots per segment | accepted (structure only) |
| FIELD-03 | field text backed by CDATA | refused with the same message as value CDATA |
| FIELD-04 | rename of a nested container | descendants' ids follow; selection stays |
| FIELD-05 | field edit on a module | refused (module renames renumber everything) |

## STRUCT — delete and duplicate

Covered: line spans, subtree copy, unique name suggestion, CDATA refusal, moved bytes,
undo.

| ID | Case | Expected |
|---|---|---|
| STRUCT-01 | delete the first/last element in a parent | indentation and one line break removed; neighbours intact |
| STRUCT-02 | delete a container holding the only reference | no dangling blank line |
| STRUCT-03 | duplicate a container whose children have conditions | conditions and annotations copied verbatim |
| STRUCT-04 | duplicate on a CRLF file | inserted block uses CRLF |
| STRUCT-05 | duplicate name collision after another duplicate | suggestion increments again |
| STRUCT-06 | inline element (same line as a sibling) | delete removes only the element range |

## NAV — reveal, follow, references

Covered: range selection, focus modes, same-file/cross-file follow, ambiguity, command
entry points, reference list.

| ID | Case | Expected |
|---|---|---|
| NAV-01 | reveal from a cursor in text content vs markup | element vs innermost node chosen consistently |
| NAV-02 | follow to a target in a file that is not open | opens at the row/range; no editor churn |
| NAV-03 | ambiguous suffix with one local copy | local copy wins (index rule) |
| NAV-04 | follow from a node whose target was deleted | refusal reason, no navigation |
| NAV-05 | references for a parameter with zero references | empty list, no notice |

## DETAIL — Details panel

Covered: field order, boolean select, inline refusal, Tab, disabled fields.

| ID | Case | Expected |
|---|---|---|
| DETAIL-01 | definition with multiplicity and literals | rows in the documented order, absent fields omitted |
| DETAIL-02 | refusal from the engine path | typed text kept, field marked invalid, one reason |
| DETAIL-03 | Tab from the last field of the last row | focus leaves the panel, no trap |
| DETAIL-04 | selection moves while a draft is open | draft cancelled, no ghost write |

## TREE — document tree, virtual scroll, copy

Covered: roles, collapse, brace rows, gutter, gaps, copy, focus, virtualization.

| ID | Case | Expected |
|---|---|---|
| TREE-01 | collapse a container whose selected child is hidden | selection moves to the nearest visible ancestor |
| TREE-02 | `documentPatch` for a row outside the rendered window | store updated, no DOM patch for hidden rows |
| TREE-03 | patch, then expand/collapse | display indices stay consistent |
| TREE-04 | 150k rows scroll to the end and back | window rebuilds, no height drift |
| TREE-05 | copy a range spanning a collapsed subtree | only visible rows, 4-space indent |
| TREE-06 | zero-height viewport | at least one row rendered |

## SEARCH — search

Covered: Enter-only, F3, collapsed matches, header rows, gaps, chunked engine, clear.

| ID | Case | Expected |
|---|---|---|
| SEARCH-01 | query matching only meta text (condition/annotation) | row found via haystack |
| SEARCH-02 | clear while a chunked search is running | results discarded, no late paint |
| SEARCH-03 | search after a documentPatch | patched haystack is used |
| SEARCH-04 | 100k rows, query with one match at the end | completes within the engine budget |

## CPANEL — conditions panel

Covered: drafts, save/cancel, duplicates, invalid names, clear, discovery, persistence.

| ID | Case | Expected |
|---|---|---|
| CPANEL-01 | Save a name that becomes scanned after a reload | row loses Remove, keeps value |
| CPANEL-02 | Clear values with a draft open | draft survives, committed values clear |
| CPANEL-03 | 200 rows then Add | refused with the cap message |

## INDEX — workspace index

Covered: upsert/remove, split packages, ambiguity, globs, max size, encodings, watcher,
rebuild race, 200k elements, reverse map invalidation.

| ID | Case | Expected |
|---|---|---|
| INDEX-01 | file renamed (create+delete) in one watch burst | one contribution, no duplicate paths |
| INDEX-02 | excluded file that becomes unexcluded | picked up on rebuild, not before |
| INDEX-03 | same file saved twice within the debounce | one reindex |
| INDEX-04 | index disabled then enabled mid-build | no stale generation served |
| INDEX-05 | reference map after 50 edits to one target file | equals a fresh build |
| INDEX-06 | file larger than `maxFileSizeMB` | skipped and reported, not partially indexed |

## VALID — validation

Covered: severities, caps, cross-file modes, multiplicity, required, duplicates, ranges,
DEST, refs, fragment mode.

| ID | Case | Expected |
|---|---|---|
| VALID-01 | severity changed while diagnostics are published | republished without a reindex |
| VALID-02 | cap 0 (unlimited) | no summary diagnostic |
| VALID-03 | module definition missing but children resolvable | one module diagnostic, children not spammed |
| VALID-04 | cross-file duplicate where one file is excluded | not reported |

## FEAT — text features

Covered: symbols order, definition cross-file, hover, links, index disabled/excluded.

| ID | Case | Expected |
|---|---|---|
| FEAT-01 | definition ref into an excluded file | no definition, no crash |
| FEAT-02 | hover on a value token | shows the documented text, not markup |

## DIFF — semantic diff

Covered: 43 model tests, pairing, renames, duplicates, word diff, contexts, gaps,
navigation, refresh, limits, headers, a11y, swap, search.

| ID | Case | Expected |
|---|---|---|
| DIFF-01 | both sides renamed to the same name, different children | one changed pair, not remove+add |
| DIFF-02 | three-way merge's pairings equal the two-file diff's pairings | re-scoped: the three-way merge was removed; two-file pairing is covered by DIFF-01 and the diff-model suite |
| DIFF-03 | file > pair budget | `semanticLimitReason` set, UI says so |
| DIFF-04 | toggle strict/semantic after a refresh | cache invalidated correctly |
| DIFF-05 | 1,200-row document with all rows changed | windowing keeps the frame budget |

## ENG — engine process

Covered: handshake, path per platform, missing binary, protocol mismatch, doc round
trip, row parity, edit fast path.

| ID | Case | Expected |
|---|---|---|
| ENG-01 | engine killed mid-session | one warning, restart with backoff, documents resynced (not implemented yet) |
| ENG-02 | oversized frame and malformed header | protocol error, process exits 1, host reports it |
| ENG-03 | panic inside an operation | error reply, process survives, next call works |
| ENG-04 | `doc.rows` chunk boundaries at 4,000 rows | client reassembles in order, no duplicate row |
| ENG-05 | plan refusals | byte-identical strings to the TypeScript plan |
| ENG-06 | `doc.update` fast path vs full path | same rows and bytes |
| ENG-07 | engine RSS on the 20 MiB document | under the recorded ceiling |
| ENG-08 | two panels, two documents | handles isolated; closing one leaves the other |

## MERGE — two-way copy merge in the diff view

Planned (see `11-14-arxml-config-merge`). The panel's merge toggle turns the comparison into
a two-way merge: arrows copy a row to the other side as one undoable edit.

| ID | Case | Expected |
|---|---|---|
| MERGE-01 | toggle off | no arrows; the plain diff is read-only (existing suites) |
| MERGE-02 | copy left→right on a changed parameter | the right value becomes the left one, one undo restores |
| MERGE-03 | copy right→left | mirrored, same bytes |
| MERGE-04 | copy a container | the whole subtree replaces the target, target-only children removed |
| MERGE-05 | placeholder arrow on the empty side | the element is deleted from the other side, one undo |
| MERGE-06 | copy into a missing parent | the ancestor chain is created; unrelated source siblings are not imported |
| MERGE-07 | copy into a missing module | refused with a message, no mutation |
| MERGE-08 | module row copy | allowed without a name collision; refused with one |
| MERGE-09 | `Alt+←` / `Alt+→` | copies the focused row; read-only mode ignores the keys |
| MERGE-10 | Swap, then copy | the arrow copies from the displayed pane, not the stored side |
| MERGE-11 | patch after a copy | panel equals a full rebuild; the answer carries the changed rows plus a range shift |
| MERGE-12 | fallback cases | `top-level-order`, `module-row`, `outside-elements`, `no-baseline`, `stale-baseline`, `parent-created`, `ancestor-changed` rebuild with a notice, never a wrong row |
| MERGE-13 | stale bytes | Reload/Cancel modal; Cancel changes nothing |
| MERGE-14 | edited pane label | `•` while dirty, cleared on save |
| MERGE-15 | 20 MiB pair | row visible < 100 ms, consistent < 250 ms, 10 copies / 10 s |

## PKG — packaging and activation

Covered: manifest, activation, engine binary path, VSIX engine verification.

| ID | Case | Expected |
|---|---|---|
| PKG-01 | VSIX without `dist/engine` | activation error naming the path |
| PKG-02 | VSIX contains every platform's engine | verify step passes for all four targets |
| PKG-03 | no `dist/native` artifact remains | absent from the VSIX |

## PERF — benchmarks

Covered: scan/rows/diff/index/validation/rename/edit-latency.

| ID | Case | Expected |
|---|---|---|
| PERF-01 | 20 MiB edit: plan + update | plan < 5 ms, update < 100 ms, push < 4 KiB |
| PERF-02 | 20 MiB merge plan + compose | under the merge ceiling, no quadratic pass |
| PERF-03 | repeated edits (100) | no retained growth beyond the ceiling |
| PERF-04 | benchmark on a missing engine | reports `skipped`, exit 0 |
| PERF-05 | 26 MiB pair: `diffBenchmark` | engine and host numbers recorded; engine stays within 2x the host builder |
| PERF-06 | 26 MiB copy: `diff.patch` | payload under 1% of the document; latency recorded (411 ms today, gate 50 ms) |

## X — cross-cutting

| ID | Case | Expected |
|---|---|---|
| X-01 | every host→page message with an unknown type | ignored, no throw |
| X-02 | every message field of the wrong type | dropped or refused, never applied |
| X-03 | a11y: roles, labels, live regions on every surface | unchanged by new UI |
| X-04 | theme: no colour literals outside the documented set | `npm run design:lint` and the colour tests |
| X-05 | read-only surfaces (diff, preview) | never write a file; hash sources before/after |

## Fixtures and determinism

- Prefer fixtures under `src/test/fixtures/**`; generate only what would be large
  (benchmarks) or combinatorial (merge scenarios).
- A test must not write a committed fixture: hash the directory before/after when the
  test writes at all.
- Time, locale and map iteration order never decide an assertion; sort before comparing.
- A performance test asserts a ceiling with a wide margin and records the number it saw.

## Known gaps (tracked, not silently accepted)

1. Engine restart/backoff and `cancel` (ENG-01) are not implemented; the crash matrix
   is documented in the engine design but untested.
2. Merge pairing depends on the TypeScript semantic matcher; a rename it cannot pair is
   an add/add conflict, and the plan says so.
3. The private 20 MiB sample stays local (`ARXML_SCOPE_SAMPLE`); CI uses the synthetic
   fixture.
4. No fuzzing yet: the scanner and parser would benefit from a corpus-based random
   input test.
5. A condition symbol with several same-tail candidates resolves to missing and lists
   the symbol once; the candidate paths are not surfaced (COND-03).
6. `parseConditionEntries` still drops entries past 200 silently for stored data; the
   panel now refuses a 201st row with a cap message (COND-04).
7. `diff.patch` latency is 411 ms against the 50 ms gate; the PERF-06 test records the
   number and the gate stays open (subtree-local rebuild).
8. `PERF-01`'s 5/100 ms ceilings are measured by `npm run benchmark engineEdit`, not
   asserted in the suite; the test documents the gate.
9. `ENG-07` has no engine-RSS measurement: the client exposes no pid and the benchmark
   records the host's retained heap only.
10. `MERGE-12` lists seven fallback codes; `ancestor-changed` is defensive and no copy
    edit reaches it. The suite pins the list and exercises the other six.
11. Disabling the index mid-build can briefly publish the in-flight snapshot before the
    queued enable rebuild; the settled state is asserted (INDEX-04).
12. The three-way merge was removed; DIFF-02 is re-scoped to the two-file pairing suite.
13. Ancestor synthesis has no end-to-end panel regression: `synthesizeInto` is a closure
    inside `DiffPanel.open`. MERGE-06 builds the wrap and insertion by hand, so the
    sibling-anchor bug would not have been caught there; the fix is covered by review only.
14. A copy's one-`WorkspaceEdit`/undo path and MERGE-15's engine patch are not exercised in
    `vscode-test` (no webview message bridge); the planner and page cover the span and the
    message shape.
15. The fuzz corpus (gap 4), ENG-01 and ENG-07 have no follow-up task: the programme's
    tasks are archived, so they live here with their reasons.
