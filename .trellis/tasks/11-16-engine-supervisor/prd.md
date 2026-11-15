# Engine supervisor, health, and restart

## Goal

Make the Rust engine recoverable: when the process dies, the host respawns it,
reopens every live document and keeps edit, diff and copy working. Surface the
engine state to the user and the support bundle.

## Requirements

- A supervisor wraps the single engine process and implements the existing
  `CoreEngine` contract. Host call sites do not learn about restarts.
- Document ids handed to the host stay stable across restarts; the supervisor maps
  them to the current process's ids.
- An exit fails in-flight requests with a message that names the engine and points
  at `ARXML Scope: Show Engine Status`. It must not silently fall back to TypeScript.
- Restart uses bounded backoff, reopens live documents with their last known text
  and row options, and gives up after repeated failures with an actionable error.
- The last error and the restart count survive until a successful request.
- `ARXML Scope: Show Engine Status` prints state, version, protocol, pid, uptime,
  restarts, open documents, pending requests, memory when available, and last error
  to an output channel; it also offers to restart the engine.
- A status bar item shows running / restarting / failed and opens the status command.
- Engine memory is reported on platforms where it is cheap to read (Linux `/proc`);
  otherwise the field says unavailable.
- `rust/README.md` stops claiming a restart that does not exist (the claim becomes
  true with this change).

## Acceptance criteria

- [ ] Killing the engine process mid-session, then editing or diffing, succeeds
      after one automatic restart and preserves the open documents' rows.
- [ ] Three rapid crashes hit the failure limit and produce one actionable error,
      not an unhandled rejection loop.
- [ ] Pending requests reject with `EngineError` code `exited` or `unavailable`.
- [ ] Disposing the extension does not spawn another engine.
- [ ] Health output includes every field above; the command is in `package.json`.
- [ ] Unit tests cover: restart and replay with a fake spawner, give-up threshold,
      stable ids, disposal, health snapshot.
- [ ] No TypeScript fallback is introduced.

## Constraints

- Protocol stays `1`; no engine wire change is required.
- The supervisor is pure Node (no `vscode` import); the command lives in the host.
- Do not add a second engine process per window.
