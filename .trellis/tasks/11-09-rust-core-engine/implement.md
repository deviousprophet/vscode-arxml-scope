# Implementation plan — Rust core engine

## 0. Sequencing

The next release must be finished and committed first. The Rust engine is the only core
engine; TypeScript is the VS Code host/UI layer. Do not add a TypeScript core fallback.

## 1. Foundation (child `11-09-rust-core-foundation`)

- [ ] Create the Rust workspace, `arxml-core` skeleton, `arxml-node` napi binding and
      `arxml-cli` parity helper.
- [ ] Add the `CoreEngine` seam in `src/host/engine/`; the Rust adapter implements it and
      the TypeScript host/UI calls it. No user-facing engine setting.
- [ ] Add the native loader with a required Rust load and a clear activation error. Do not
      add an engine setting or a TypeScript core fallback.
- [ ] Build a hello-world native call and a smoke test in the extension host.
- [ ] Add the parity harness skeleton (fixtures, canonical JSON, diff runner).
- [ ] Add Rust CI (fmt, clippy, test, build) and a package smoke test.
- [ ] Record the build/VSIX spike: target matrix, addon size, cold load, contributor
      impact.

Gate: `npm test` unchanged with TS; the loader uses the hello call when the addon is
present; parity harness reports the expected placeholder; no native artifact required for
normal builds.

## 2. Index engine

- [ ] Port the XML stream parser with chunk-boundary and malformed-tail parity.
- [ ] Port the ECUC scanner/model and index builder; compare `FileIndex` canonically.
- [ ] Port workspace lookups, suffix/ambiguity resolution, copies and reverse references.
- [ ] Add compact storage and coarse query methods; measure end-to-end retained heap.
- [ ] Add index parity and performance benchmarks.

Gate: 54 MiB index parity, ≥3x faster and ≤60% heap, or a documented measured exception.

## 3. Validation engine

- [ ] Port the seven rules, severities, cross-file modes and caps.
- [ ] Port sliced iteration and diagnostic positions.
- [ ] Compare diagnostics canonically (rule/severity/file/range/message).
- [ ] Measure the full pass and slice budget.

Gate: 36 MiB validation parity, ≥2x faster, slice budget unchanged.

## 4. Semantic diff engine

- [ ] Port the next-release matcher, including blocking, learning, deterministic budget and
      fallback reason.
- [ ] Keep row construction in TS; return pairs/decisions and summary.
- [ ] Run the 500/700 benchmark against both engines; compare pairs and counts.
- [ ] Add near-tie, oversized-bucket and deterministic-budget parity tests.

Gate: pair-for-pair parity on fixtures/corpora; 500/700 within the next-release bound.

## 5. Integration and release

- [ ] The Rust engine is the only core engine; no setting or per-platform opt-in.
- [ ] Package one universal VSIX with every native directory; smoke-load each target.
- [ ] Add required-engine error diagnostics and user-facing documentation.
- [ ] Update `docs/`, `README`, `CHANGELOG`, architecture notes and rollback instructions.
- [ ] Run the full TS suite with both engines, parity in CI, all benchmarks and a manual
      VS Code pass.
- [ ] Release the Rust engine; remove the transitional TypeScript core after the final port.

## 6. Validation commands

```bash
# Rust
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace

# Native addon
npm run rust:build
npm run rust:smoke

# TypeScript / extension
npm run check-types
npm run lint
npm test
npm run benchmark
npm run parity
```

## 7. Review gates

1. Foundation: seam, required load, no behavior change.
2. Index: parity + measured performance.
3. Validation: parity + slice budget.
4. Diff: pair parity + 500/700 scale.
5. Release: packaging matrix, required-engine smoke test, docs, rollback.

## 8. Rollback points

- **Foundation:** remove the adapter/loader and the native package; do not add a TypeScript
  core fallback.
- **Index/validation/diff:** revert a Rust port without reintroducing a TypeScript engine.
- **Release:** revert to `typescript` default or ship without the native package; no
  persisted state to migrate.

## 9. Do not start

- WASM/web build, sidecar/LSP, broader ARXML coverage, graph views or editing expansion.
- Deleting a transitional TypeScript core module before its Rust port and parity gate pass.
- Enabling Rust by default before parity and performance gates pass.
