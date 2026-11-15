# v0.10.0 review — source findings

Copied from `H:/workspace/V0_10_0_REVIEW.md` so the task is self-contained.

Tag `v0.10.0` (`b292ecd`). Verdict: scanner, rows, node ids, conditions, edit
planning and the whole diff run in a separate Rust process with parity against the
TypeScript oracles. Four problems should be handled next: no restart after the
engine dies, documents over 64 MiB cannot be sent, rename matching gaps were ported
unchanged, and initial load through the engine is slower than TypeScript.

## Findings

| # | Finding | Impact | Suggested fix |
|---|---------|--------|---------------|
| 1 | No restart. `EngineClient` fails pending requests and stays closed. | Edit, diff and copy stop until window reload | Supervisor with restart and backoff, re-open live documents, clear error, fix docs |
| 2 | 64 MiB frame limit. A larger document cannot be uploaded; no diff fallback. | Large ECUC files cannot be diffed or edited | Chunked `doc.open`, higher limit, or streamed upload; clear message meanwhile |
| 3 | Rename-matching gaps carried over. | A bulk rename shows removed plus added | F1 and F2 in the Rust diff; update the oracle deliberately |
| 4 | Initial load slower; document held in engine and TypeScript. | Time to first paint and memory | Engine-built first row store; row windows; memory accounting |
| 5 | Full resync about 1.7 s at 26 MiB for non-value edits. | Typing and large copies | Incremental re-parse or debounce |
| 6 | Copy planner is TypeScript (`core/copy/planCopy.ts`). | Violates "no domain logic in TypeScript" | Port to Rust with diff and patch |
| 7 | Platform coverage: linux-x64, win32-x64, darwin-x64, darwin-arm64 only. | Hard failure on ARM Linux, Windows ARM, Alpine | Add targets or document supported platforms; explicit message |
| 8 | `diff.compute` is one request with a 60 s timeout and no cancel. | Long diff cannot be cancelled | Cancel and time budget at protocol level |
| 9 | Docs drift: README says the diff port remains and lists no `diff.*`. | Contributor confusion | Update `rust/README.md` |
| 10 | No `cargo deny`, `cargo audit`, Dependabot or fuzz job. | Untrusted ARXML parsed in native code | Add them; fuzz the scanner |
| 11 | Extension-host tests not run for engine, merge, editing on all platforms. | Merge and edit only partly covered | Run `npm test` locally and in CI on all four platforms |

## Rename shapes that fail

| Case | Rust result |
|------|-------------|
| 500 `NMH_` to `NM_` | 500 paired |
| 500 `Old_` to `New_` (wholly different token) | 0 paired |
| 200 `Old_` to `New_` plus 300 unchanged | 0 paired |
| 50 `NMH_` to `NM_` plus 50 new sorting before | 0 paired |
| 10 renamed plus 10 new sorting before | 0 paired |
| 50 renamed plus 50 new sorting after | 50 paired |
| 55 old, 50 renamed | 50 paired |
| 500 unrelated replacements | 0 paired (correct) |
| 500 same names, edited values | pairs by identity (correct) |

Improvements to keep: crash isolation, panic guard per request, handshake with a
protocol check, 82/159/44 parity comparisons, documented frame protocol.

## Performance baseline (26 MiB, 73,884 rows)

| Operation | TypeScript | Rust |
|-----------|------------|------|
| One value edit | about 1.7 s | 40–50 ms |
| First load | 1.1 s | 2.7 s (open plus rows) |
| Diff, 52 MiB pair | 1.41 s plus 0.22 s JSON | 1.42 s, 67 MiB payload |
| General non-value edit | about 1.7 s | about 1.7 s (full resync) |
