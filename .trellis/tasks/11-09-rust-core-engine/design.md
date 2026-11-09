# Technical design — Rust core engine

## 1. Architecture decision

**Primary:** an in-process native addon built with `napi-rs`, backed by a pure Rust
`arxml-core` crate. **Not in the Rust engine release:** WASM/web build, sidecar/LSP
process, or a full web extension. TypeScript is the VS Code host/UI layer; there is no
TypeScript core fallback.

Why native:

- The measured costs are CPU and object-allocation costs on large text, which native Rust
  and compact layouts address directly.
- N-API is ABI-stable across Node/Electron versions, so one binary per platform/arch can
  serve the VS Code extension host without an Electron rebuild matrix.
- Keeping the engine in-process preserves the current host call model and avoids a
  protocol/process manager during the parity migration.
- WASM remains a later option for web/unsupported platforms if that becomes a product
  requirement; it is not the primary Rust engine.

Why keep TypeScript:

- It is the VS Code host, webview and row-rendering layer. It is not a second core engine.
- The transitional core modules are a migration test oracle only; they are removed as the
  Rust ports land and never form a runtime fallback.
- The webview, row rendering and VS Code glue stay TypeScript regardless.

## 2. Workspace layout

```
rust/
  Cargo.toml                 # workspace
  arxml-core/                # pure Rust library, no Node dependency
    src/
      lib.rs
      xml/                   # stream tokenizer
      ecuc/                  # scanner/model
      index/                 # index builder, lookups, reverse refs
      validation/            # rules, severities, slices
      diff/                  # semantic matcher (pairs, not DOM rows)
      model/                 # shared records and compact storage
  arxml-node/                # napi-rs binding crate
    src/lib.rs
  arxml-cli/                 # parity/debug CLI (optional, useful in CI)
src/host/engine/
  coreEngine.ts              # pure contract
  rustEngine.ts              # native adapter
  nativeLoader.ts            # platform/arch resolution + required load
```

The extension bundle does not import Rust types. `arxml-node` exposes coarse operations;
`rustEngine.ts` converts at the boundary. There is no `typescriptEngine.ts`.

## 3. Engine seam

```ts
export interface CoreEngine {
  readonly kind: 'rust';
  createIndexBuilder(uri: string): IIndexBuilder;
  createWorkspaceIndex(): IWorkspaceIndex;
  validate(index: IWorkspaceIndex, options: ValidationOptions): Diagnostic[];
  validateSlices(index: IWorkspaceIndex, options: ValidationOptions): Iterable<Diagnostic[]>;
  matchDiff(left: PreparedDiffSide, right: PreparedDiffSide, options: DiffOptions): DiffMatchResult;
  dispose(): void;
}
```

Start with the existing host call sites. The seam should be thin: `indexService`,
`validationService`, `navigation` and `diffPanel` already have natural inputs/outputs.
Do not create a generic RPC; name the operations the host actually needs.

### Data boundary

The first Rust milestone may return JS objects for parity. The performance milestone must
move to coarse calls and compact storage:

- Rust owns the workspace index. JS calls `element(path)`, `definition(path)`,
  `referencesFor(target)`, `validate`, `matchDiff`; it does not receive the whole index.
- For list-returning calls, use typed arrays or chunked records with a documented
  schema; avoid one JS object per element on the hot path.
- Keep ranges as offsets; convert to line/column only at the VS Code boundary.
- Strings cross as UTF-8/UTF-16 explicitly; document the encoding contract.
- No `serde_json` per element inside a hot loop. Serialize coarse results or use napi
  arrays/structs.

The parity milestone can use a JSON adapter; the performance milestone must prove the
end-to-end retained heap after the boundary, not just the Rust-side heap.

## 4. Module migration

1. **XML stream parser.** Port `xmlStream.ts` behavior: chunk boundaries unobservable,
   comments/PI/CDATA, offsets in UTF-16 code units (or a documented conversion). Add
   malformed-tail behavior tests.
2. **ECUC scanner/model.** Port `scanner.ts` and the model records used by rows,
   navigation and conditions. Keep row rendering in TS.
3. **Index builder.** Port `indexBuilder.ts` and `FileIndex`; line starts; definitions;
   references; content hash; schema release.
4. **Workspace index.** Port lookups, suffix resolution, copies, reverse references,
   delta updates. Prefer a compact store with explicit query methods.
5. **Validation.** Port all seven rules, severities, cross-file modes, diagnostic caps and
   slices. Positions remain offsets at the core boundary.
6. **Semantic diff.** Port the next-release matcher exactly: blocking, learning, deterministic
   budget, near-tie margin, fallback reason. Return pairs/decisions; TS builds rows.
7. **Editing and write path.** Stay TypeScript. Rust may expose scan/validate for the
   pre-write check, but the edit planner and byte-preserving write remain TS.

## 5. Parity harness

- **Golden fixtures:** every committed fixture under `src/test/fixtures/`, with canonical
  JSON output (sorted keys/arrays where order is semantic).
- **Generated corpora:** index (54 MiB), validation (36 MiB), large ECUC (26 MiB), rename
  (500/700), plus edge shapes (duplicate suffixes, split packages, encodings, CDATA,
  malformed tails).
- **Oracle:** captured expectations from the current release; the transitional TS core may
  be used only as a test-time oracle, never as a runtime engine.
  test intentionally pins a known behavior.
- **Comparison:** elements, definitions, references, resolution results (found/ambiguous/
  missing), diagnostics (rule/severity/file/range/message), semantic pairs (left/right,
  score/reasons/fallback) and summary counts.
- **CI:** run parity on every PR that changes either engine. A Rust-only change cannot
  merge without TS parity; a TS-only core change must update the Rust parity corpus.
- **Determinism:** run each corpus twice; assert identical output.

## 6. Performance and memory gates

Set after the foundation benchmark, with the CI baseline recorded. Starting targets:

| Surface | Target |
|---|---|
| Index build 54 MiB | ≥3x faster than the next release TS; ≤60% retained heap |
| Validation 36 MiB | ≥2x faster; same diagnostics; slices under the host budget |
| Reverse references | no full rebuild on a single-file save, or measured below 100 ms |
| Rename 500/700 | parity with next-release bounds; no regression |
| VSIX size | documented ceiling; native artifact size included |
| Cold load | native addon load time within the activation budget; missing-addon error path bounded |

Measure end-to-end from the host call, including boundary conversion and retained JS
memory. A Rust microbenchmark alone is not a gate.

## 7. Packaging and CI

- `napi-rs` build per target: Windows x64 (and arm64 if supported), Linux x64/arm64
  (glibc; musl/Alpine only if a target is required), macOS x64/arm64.
- N-API version pinned to the lowest VS Code host baseline; verify on stable and insiders.
- Distribution: one universal VSIX with every native directory (linux-x64, win32-x64,
  darwin-x64, darwin-arm64). Build each target on its own runner and package once. The
  native artifact is required; a missing or incompatible addon is an activation error.
- CI: build/test Rust, run cargo tests/clippy/fmt, build the addon, run the parity harness,
  package each target, smoke-load the addon in a VS Code test host, and publish artifacts.
- Contributor path: `npm ci` must not require Rust; `npm run compile`, `npm test`,
  `npm run package` and the release workflows build the addon and require the Rust
  toolchain. There is no TypeScript core fallback.
- Versioning: ABI is the runtime compatibility contract. The native package version is
  diagnostic until release packaging aligns it with the extension version; a later
  integration child adds the strict version check.

## 8. Rollout and rollback

- **Phase 0:** foundation merged; the required addon loads and the probe is green.
- **Phase 1:** port index/validation/diff behind the Rust-only seam; run the parity gate.
- **Phase 2:** release the Rust engine with the universal native VSIX.
- **Phase 3:** remove the transitional TypeScript core modules after the final port.
- **Rollback:** revert the release or the offending port; do not reintroduce a TypeScript
  core fallback. There is no persisted state or migration to undo.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Rust/TS drift | Parity harness as a required CI gate; one engine changes only with the other |
| Boundary erases gains | Coarse calls, compact storage, end-to-end memory measurement |
| Platform/ABI breakage | N-API, per-target CI smoke test, activation error |
| Contributor friction | Rust required for compile/test/package/release; `npm ci` remains JS-only |
| Debuggability | Rust CLI/parity tool, structured errors, no silent divergence |
| Scope creep into 1.0 features | This task is engine parity only; feature work is separate |
| Native crash | Isolate panics; no unsafe without review; release health checks |
| Packaging size | Measure VSIX per target; mandatory native directory or documented ceiling |
