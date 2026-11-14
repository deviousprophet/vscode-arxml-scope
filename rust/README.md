# Rust core engine

The Rust workspace contains the extension's core engine, run as a **standalone
process** — there is no N-API addon and no TypeScript fallback:

- `arxml-core` — the pure domain engine (no Node, no VS Code): ECUC scanner, model,
  node ids, ordering, rows, conditions, validation, edit planning.
- `arxml-engine` — the stdio process: framing, document handles, row streaming,
  edit plans, panic guard.
- `arxml-cli` — debug probe, `scan`/`rows` parity output and the fixture manifest.

## Build and test

```bash
cargo test --manifest-path rust/Cargo.toml --workspace
cargo clippy --manifest-path rust/Cargo.toml --workspace --all-targets -- -D warnings
cargo fmt --manifest-path rust/Cargo.toml --all -- --check
npm run engine:build        # writes dist/engine/<platform>-<arch>/arxml-engine[.exe]
npm run engine:smoke        # spawn, handshake, open a fixture, plan an edit, shut down
npm run parity              # fixture-manifest parity with the TypeScript side
npm run parity:rows         # row-store parity against the TypeScript oracle
```

`npm run engine:build` stages the release binary under `dist/engine/`. The host
loads it from `enginePath()` in `src/host/engine/engineLoader.ts`; a missing binary
or a protocol mismatch is an activation error. The binary is a release/CI artifact,
not a source file.

## Protocol

One long-lived process per extension-host window, stdio only:

```
[u32 LE payload_len][u16 LE header_len][header JSON utf8][body bytes]
```

The header carries `id`, `op`, `ok` and small scalars; the body carries document
text and row JSON raw, so a 26 MiB document is uploaded once and never escaped
again. Requests are answered in order per `id`; operations that can exceed one
frame stream chunks and mark the last with `"chunk":{"last":true}`.

Operations: `hello`, `shutdown`, `doc.open`, `doc.close`, `doc.rows`,
`doc.plan`, `doc.update`, `doc.resync`, `doc.node`, `doc.model`.

`doc.update` answers with one contiguous row replacement
(`{"at":n,"remove":m,"rows":[…]}`): a value edit is one row, a container rename is
the renamed subtree. The engine never writes a file — the host applies the plan as
one `WorkspaceEdit`, so undo, dirty state and save stay VS Code's.

## Status

The engine process is the required core at activation, and its scanner, rows,
conditions and edit plans are at parity with the TypeScript oracle over the whole
fixture corpus (`npm run parity:rows`).

The ECUC editor's edit path runs through it: `doc.plan` returns the span and bytes to
write, and `doc.update` answers a value edit with one row in place (a splice plus a
range shift, no re-parse and no row rebuild). The panel's first row store is still
built in TypeScript, and the workspace index, validation and diff ports remain
(`.trellis/tasks/11-13-rust-edit-engine/implement.md`).

`npm run benchmark sampleFile` measures a local file named by `ARXML_SCOPE_SAMPLE`
and reports `skipped` without it, so no private document enters the repository.
