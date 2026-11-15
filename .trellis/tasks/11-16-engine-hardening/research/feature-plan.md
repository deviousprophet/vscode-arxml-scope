# v0.11.0 feature plan — source scope

Copied from `H:/workspace/ARXML_EXTENSION_FEATURE_PLAN.md` so the task is
self-contained.

## Position after v0.10.0

- Rust process required at activation; scanner, model, rows, node ids, conditions,
  edit planning, word diff, diff and patch are in Rust (9.7k lines).
- Workspace index, validation, text features and the copy planner are TypeScript.
- Four engine targets ship in one VSIX: linux-x64, win32-x64, darwin-x64,
  darwin-arm64.

## v0.11.0 scope

| Track | Items |
|-------|-------|
| Move to Rust | R2 index, definitions, copy-aware resolution, reverse map, exclude globs, encodings, rebuild guard, unsaved overlay. R3 validation. R6 text-feature data. Copy planner. |
| Robustness | P1 supervisor, P2 large documents, P3 cancellation, P7 health, P8 memory, P9 platforms |
| Performance | P4 incremental re-parse, P5 row windows and engine-built first store |
| Diff | F1–F4 rename matching |
| Cleanup | README and comment drift, correct the benchmark label for the resync path, delete proven TypeScript |

Exit criteria: no domain logic in `host/` or `webview/` for index, validation and
text features; parity for index and validation; performance gates met or revised;
real-project soak complete.

## Robustness requirements (P1–P9)

| ID | Requirement |
|----|-------------|
| P1 | Supervisor: restart on exit with backoff, re-open live documents, fail pending requests with a clear message, surface status, give up after repeated failures, fix docs that claim restart. |
| P2 | Large documents: chunked or streamed `doc.open`, or a higher limit, so files above 64 MiB work; clear message meanwhile. |
| P3 | Cancellation and budgets for `diff.compute` and long operations. |
| P4 | Incremental re-parse for general edits (today about 1.7 s at 26 MiB). |
| P5 | Row windows on demand; engine-built first row store so the document is held once. |
| P6 | UTF-16 offsets at the boundary, with non-ASCII and CRLF tests. |
| P7 | Health command with version, protocol, memory, uptime, last error, output channel. |
| P8 | Measure engine process memory in benchmarks and status. |
| P9 | Add linux-arm64, win32-arm64 and Alpine x64, or document the list and make the failure explicit; consider per-platform VSIX. |

## Rename requirements (F1–F4)

| ID | Requirement |
|----|-------------|
| F1 | Self-name masking: replace each container's own short name inside its child values before comparing. |
| F2 | Position-independent blocking: candidates come from a hash of masked child keys plus name tokens, not sibling position. |
| F3 | Tests at several shapes and sizes: `NMH`/`NM`, `Old`/`New`, mixed unchanged, renamed and new, extras before/after/interleaved, near-ties, 10/50/500/2,000. |
| F4 | Keep guarantees: different `DEFINITION-REF` never pairs, unrelated content never pairs, ties stay unpaired, deterministic, Strict matches the old output. Update the oracle deliberately. |

## Performance gates (selected)

| Metric | Today | Target |
|--------|-------|--------|
| Value edit | 40–50 ms | keep |
| First load | 2.7 s engine | 0.8 s or less |
| Rows payload | 49 MiB | windows, 2 MiB or less |
| General edit | about 1.7 s | 100 ms or less |
| Diff 52 MiB | 1.4 s, 67 MiB | 0.7 s or less |
| Index build 54 MiB | 1.5–1.8 s | 0.4 s or less |
| Validation 36 MiB | 1.2–1.5 s | 0.4 s total |

## Roadmap after this task

- v0.11.0 completion: R2/R3/R6/R7, P3/P4/P5.
- v0.12.0: delete the TypeScript core; version detection and bundled XSDs.
- v0.13.0: schema completion, diff against a Git revision, folder compare, export.
- v1.0+: non-ECUC coverage, reference editing, language server and CLI.
