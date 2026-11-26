# The Rust engine

ARXML Scope runs its ECUC core in a separate Rust process. This page is the operator-facing summary:
what the process is for, how it is supervised and how to inspect it. The wire protocol table and the
Rust crate layout live in [`rust/README.md`](../../rust/README.md); the host session contract lives in
[`editor-lifecycle.md`](../../.trellis/spec/frontend/editor-lifecycle.md).

## Why a process

- A native failure cannot take the extension host down.
- The same engine is reusable for a language server and a CLI.
- The host stays glue and rendering.

There is no TypeScript fallback for the core and no engine setting. Activation fails when the
engine is missing, unsupported or speaks another protocol. (A panel that cannot open an engine handle
can stay on the host-side TypeScript row path for that session; that is a degraded panel, not a second
core.)

## Lifecycle

1. Activation starts one process and completes a `hello` handshake.
2. The supervisor tracks every open document with its URI, text and row options.
3. If the process exits, in-flight requests reject and the supervisor spawns a new
   process with bounded backoff.
4. Live documents are reopened with their last text; host document ids stay stable.
5. After repeated failures the supervisor stops and reports an actionable error.

The supervisor never writes a file. The engine answers data, plans and patches; the
host applies one `WorkspaceEdit`, so undo, dirty state and save stay VS Code's.

## Status and support

Run `ARXML Scope: Show Engine Status` from the command palette. It prints state,
engine version, protocol, pid, uptime, restart count, open documents, pending
requests, memory (Linux) and the last error, and offers `Restart Engine`.

The VSIX ships `linux-x64`, `win32-x64`, `darwin-x64` and `darwin-arm64`. Any other
target fails activation with that list. Large documents use the chunked upload path
(8 MiB chunks, 512 MiB cap); single-frame open refuses above 64 MiB.

## Find and replace

The engine owns find: `doc.search` and `diff.search` apply case-sensitive,
whole-word and regex options over the visible row fields, and `doc.replace` returns
validated plans for parameter values and container short names. The page's find bridge
only maps those matches and draws Monaco's highlight marks.

## Limits

- Cancelling a long diff is not supported yet; restarting the engine is the coarse
  cancel.
- A non-value edit still takes a full resync in the engine, about 1.7 s at 26 MiB.
- The first row store is still built in TypeScript when a panel opens and after a
  structural change.

Build, test and packaging commands for the engine are in
[DEVELOPMENT.md](DEVELOPMENT.md); the parity and gate rows are in
[TEST_PLAN.md](TEST_PLAN.md).
