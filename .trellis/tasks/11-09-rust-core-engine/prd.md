# Rust core engine

## Context

next-release fixes the semantic rename matcher in TypeScript. The Rust engine architecture decision
is to move the CPU-heavy core (XML/ECUC parsing, workspace index, validation and semantic
matching) to a Rust engine while keeping VS Code glue, row rendering and the webview in
TypeScript.

The Rust review in
`.trellis/tasks/11-09-scalable-rename-matching/research/00-plan-and-rust-review.md`
concluded that Rust is not the next-release fix, but it is a reasonable Rust engine direction
once the algorithm and data layout are understood. This task is that Rust engine epic.

## Goal

A Rust core engine that is behaviorally equivalent to the current ECUC behavior, materially
faster and smaller for index/validation workloads, and shippable across the supported VS
Code platforms. TypeScript is the VS Code host and UI layer only.

The Rust engine is the core engine on every supported platform. There is no TypeScript
core fallback and no user-facing engine switch. The existing TypeScript core modules are
transitional test material and are removed as each port lands.

## In scope

- A Rust workspace with a pure core crate and a Node binding (napi-rs) for the extension
  host.
- Ports of the existing ECUC core surfaces: stream XML parsing, ECUC scan/model, index
  builder, workspace index and lookups, reverse references, validation rules/slices and
  the semantic rename matcher.
- A TypeScript `CoreEngine` seam so host/UI code does not depend on native details.
- A required Rust engine with a clear activation error when the addon is missing or
  incompatible; no TypeScript core fallback and no user-facing switch.
- A cross-language parity harness using the existing fixtures, synthetic corpora and the
  captured behavioral expectations as the oracle.
- Performance and memory gates for index build, validation, reverse references and
  500/700-container rename matching.
- Platform packaging and CI for the supported OS/architecture matrix, including a clean
  failure path when a native binary is unavailable.
- Documentation, release notes and rollback instructions.

## Out of scope

- New 1.0 product features (broader ARXML/Adaptive coverage, graph views, schema
  completion, editing expansion). Those are separate Rust engine feature tasks.
- A web extension / WASM build. The extension is Node-only today; WASM is a separate
  decision if web support becomes a requirement.
- A standalone language server or sidecar process. The native in-process engine comes
  first; LSP extraction remains a later architecture task.
- Rewriting the webview, row rendering, VS Code API glue or the edit/write path.
- Changing semantic thresholds, diff UX, editing rules or the "never invent a pair" rule.

## Requirements

1. **Behavioral parity.** For every existing fixture and the synthetic corpora, the Rust
   engine returns the same elements, definitions, references, diagnostics, resolution
   results and semantic pairs as the captured current-release behavior, after canonical
   ordering. The transitional TypeScript core may be used only as a test oracle.
   Known intentional differences must be documented and tested.
2. **Engine seam.** Host services call a `CoreEngine` interface implemented by the Rust
   addon. TypeScript remains the VS Code host/UI layer; it is not a second core engine.
3. **Required engine.** If the native binary is missing, incompatible or fails to load,
   activation fails with a clear error. There is no TypeScript core fallback.
4. **Performance.** On the agreed corpora and CI baseline: index build is at least 3x
   faster and retains at most 60% of the current baseline heap; validation is at least 2x
   faster; the 500/700 rename benchmark remains within the next-release bound. Final numbers are
   set with measured evidence, not estimates.
5. **Packaging.** Supported platform/arch targets build reproducibly in CI, package into
   installable VSIX artifacts, and pass a smoke test that loads the native module. The
   extension version and marketplace target metadata are documented.
6. **Conformance suite.** The existing UI/host tests pass. Core behavior is checked against
   captured expectations; the transitional TypeScript core may be used as a test oracle
   only, never as a shipped runtime fallback. New Rust unit tests cover
   parser/index/validation/matcher edge cases.
7. **No persisted state.** No index/cache file is written beside user files. Any native
   allocation is released; no process or sidecar is left behind.
8. **Documentation.** Architecture, build, required-engine failure and rollback are
   documented.

## Constraints

- `src/core/**` remains free of `vscode` and DOM imports. The Rust engine is reached
  through a host adapter, never directly from pure core.
- No behavior change to editing, undo, validation policy or diff UX without a separate
  task and tests.
- The transitional TypeScript core may remain only as a test oracle during migration; it
  must not be shipped as a runtime fallback and is removed by the final integration.
- Native artifacts must match the extension host ABI. N-API is the compatibility layer;
  do not depend on a specific Electron Node version.
- Supported release targets are `linux-x64`, `win32-x64`, `darwin-x64` and `darwin-arm64`.
  Windows arm64 and Linux musl are unsupported in this release and fail activation clearly;
  there is no TypeScript core fallback for them.
- The package must not require Rust for `npm ci`; the compile/test/package/release build
  does require it. A prebuilt/addon path or a documented required build is acceptable.
- Benchmarks use synthetic data only; no customer files.

## Task map

Children are created as each gate opens; the parent owns the sequence and final
integration.

1. **Foundation and parity harness** (`11-09-rust-core-foundation`) — Rust workspace,
   napi skeleton, engine seam, parity harness, CI/build spike, benchmarks.
2. **Index engine** — stream parser, ECUC scan/model, index builder, workspace index,
   reverse references; parity + performance gate.
3. **Validation engine** — rules, severities, slices and diagnostic positions; parity.
4. **Semantic diff engine** — matcher parity and 500/700 scale; row building stays TS.
5. **Integration and release** — Rust engine, platform packaging, docs, benchmarks,
   release/rollback.

## Acceptance criteria

- [ ] `CoreEngine` exists and is implemented by the Rust addon; host services use it.
- [ ] Rust engine passes the parity harness for all fixtures and the synthetic corpus.
- [ ] UI/host suite passes; the covered core surfaces have Rust tests.
- [ ] Index/validation/rename gates meet the measured thresholds in CI.
- [ ] Platform VSIX artifacts load the native engine in a smoke test; a missing-binary
      activation error is tested.
- [ ] No new file writes, no leaked process, no `vscode` import under `src/core/**`.
- [ ] Docs cover architecture, build, required-engine failure and rollback.
- [ ] The Rust engine is the only core engine on the four supported targets; unsupported
      platforms are not part of this release contract.

## Open decisions

- Final platform/arch matrix and whether arm64 Windows/Linux/macOS ship in the Rust engine release.
- One universal VSIX with every native directory (resolved in the foundation spike);
  platform matrix and installer size remain open.
- Whether the Rust engine owns the semantic scorer only, or also the diff row model. The
  default plan keeps row building in TS to limit the boundary.
- Whether a WASM build is worth maintaining for web/unsupported platforms.
- Whether worker threads are still needed once the native engine runs off the JS heap.
