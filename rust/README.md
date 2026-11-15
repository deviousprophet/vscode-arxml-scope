# Rust core engine

The Rust workspace contains the extension's core engine, run as a **standalone
process**. There is no N-API addon and no TypeScript fallback:

- `arxml-core` - the pure domain engine (no Node, no VS Code): ECUC scanner, model,
  node ids, ordering, rows, conditions, edit planning, the semantic diff, word diff,
  diff patching and the merge copy planner.
- `arxml-engine` - the stdio process: framing, document handles, chunked upload, row
  streaming, edit plans, copy plans, panic guard.
- `arxml-cli` - debug probe and the parity surface: `scan`, `rows`, `diff`, `words`,
  `copy` and the fixture manifest.

## Build and test

```bash
cargo test --manifest-path rust/Cargo.toml --workspace
cargo clippy --manifest-path rust/Cargo.toml --workspace --all-targets -- -D warnings
cargo fmt --manifest-path rust/Cargo.toml --all -- --check
npm run engine:build        # writes dist/engine/<platform>-<arch>/arxml-engine[.exe]
npm run engine:smoke        # spawn, handshake, chunked open, rows, plan, diff, patch
npm run parity              # fixture-manifest parity with the TypeScript side
npm run parity:rows         # row-store parity against the TypeScript oracle
npm run parity:diff         # semantic diff parity against the TypeScript oracle
npm run parity:words        # word-diff parity
npm run parity:copy         # copy-planner parity
```

`npm run engine:build` stages the release binary under `dist/engine/`. The host loads
it from `enginePath()` in `src/host/engine/engineLoader.ts`; a missing binary, an
unsupported platform or a protocol mismatch is an activation error. The binary is a
release/CI artifact, not a source file.

## Protocol

One long-lived process per extension-host window, stdio only:

```
[u32 LE payload_len][u16 LE header_len][header JSON utf8][body bytes]
```

The header carries `id`, `op`, `ok` and small scalars; the body carries document
text, row JSON and diff patch JSON raw. Requests are answered in order per `id`;
operations that can exceed one frame stream chunks and mark the last with
`"chunk":{"last":true}`.

| Operation | Purpose |
|-----------|---------|
| `hello` | protocol version and engine version |
| `shutdown` | end the process |
| `doc.open` | open a document from one body frame |
| `doc.open.begin` / `doc.open.chunk` / `doc.open.end` | chunked document open |
| `doc.close` | drop a document handle |
| `doc.rows` | stream row JSON in `doc.rows` order |
| `doc.plan` | plan one value or field edit |
| `doc.update` | apply text changes; answers one row patch |
| `doc.resync` | replace a document's text from one frame |
| `doc.resync.begin` / `doc.resync.chunk` / `doc.resync.end` | chunked text replacement |
| `upload.abort` | drop a partial chunked upload |
| `doc.node` | one node's model entry |
| `doc.model` | the document's module tree |
| `diff.compute` | stream the semantic diff |
| `diff.patch` | rows changed by one copy |
| `copy.plan` | one merge arrow's span, computed from document ids |

### Large documents

`doc.open` carries the whole text in one frame and refuses a request above 64 MiB.
The host switches to the chunked path above 56 MiB: raw UTF-8 byte chunks of 8 MiB,
assembled by the engine before decoding, with a 512 MiB document cap. Chunks may
split a multi-byte character; chunk order is checked and a bad sequence drops the
upload.

### Supervisor

The host runs the process through a supervisor. If the process exits or answers with
a protocol error, a new one is spawned with bounded backoff, the live documents are
reopened with their last text and row options, and the host's document ids stay
stable. Repeated failures stop with an actionable error. `ARXML Scope: Show Engine
Status` reports state, pid, uptime, restarts, memory on Linux and the last error, and
offers a restart.

## Platform support

The packaged VSIX ships four engine binaries:

- `linux-x64`
- `win32-x64`
- `darwin-x64`
- `darwin-arm64`

Other targets fail activation with a message that names this list. Build from source
with `npm run engine:build` on a supported platform; do not replace the binary with an
untested one.

## Status

The scanner, rows, node ids, conditions, edit plans, word diff, semantic diff, diff
patch and copy planner are in Rust and gated by the parity scripts. The workspace
index, validation, text-editor features and the webview renderer are still
TypeScript; moving them is the rest of the v0.11.0 plan.

`npm run benchmark sampleFile` measures a local file named by `ARXML_SCOPE_SAMPLE`
and reports `skipped` without it, so no private document enters the repository.
