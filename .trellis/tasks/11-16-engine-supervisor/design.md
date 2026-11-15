# Engine supervisor — technical design

## Modules

- `src/host/engine/engineClient.ts` — one process. Add `pid`, `pendingCount`, an
  `onExit` callback, and make protocol corruption close the process instead of only
  rejecting pending requests.
- `src/host/engine/engineSupervisor.ts` — new. Owns a `CoreEngine` from
  `createEngine`, a document registry, restart policy and health.
- `src/host/engine/coreEngine.ts` — add optional `health()`, `restart()` and
  `onDidChangeState()` so test doubles keep compiling.
- `src/host/engine/engineLoader.ts` — return the supervisor. Keep the injected
  spawner shape `(binary, root) => Promise<EngineClient>`.
- `src/extension.ts` — status bar item, output channel, command registration.
- `package.json` — command contribution.

## State

```ts
type EngineProcessState = 'running' | 'restarting' | 'failed' | 'disposed';

interface LiveDocument {
  id: number;              // stable host id
  uri: string;
  text: string;            // last known text, UTF-16
  options: EngineRowOptions;
  processId?: number;      // current process doc id
}
```

`nextDocumentId` is a supervisor counter starting at 1. A map `id -> LiveDocument`
owns the text; `processId` is replaced after a replay.

## Request path

```
request(op)
  -> ensureClient()            // spawns + replays when closed, shares one promise
  -> translate docIds in header/left/right
  -> client request
  -> on EngineError code exited/unavailable: invalidate client, reject this call
```

The next call triggers a restart. The supervisor also listens to `onExit` and marks
the state `restarting` immediately, so the status bar reacts before the next request.

## Restart policy

- `RESTART_WINDOW_MS = 60_000`, `MAX_RESTARTS = 5`.
- Delay: `min(100 * 2^attempt, 2_000)` ms before the spawn.
- A successful handshake and replay resets `attempt` only after a successful
  request, not immediately, so a crash-on-open loop still reaches the limit.
- After the limit: state `failed`, `lastError` names the exit and the status command;
  `ensureClient` throws `EngineError('engine is unavailable; ...', 'unavailable')`.
- `restart()` clears the failure counter and forces a new process; used by the
  status command.

## Replay

For each live document in insertion order:
1. `createEngine(newClient, version)`
2. `openDocument(uri, text, options)` -> `processId`
3. On any failure: dispose the new process, keep the registry, count a failed
   restart and throw.

Host `updateDocument` applies the edits to the stored text before forwarding, using
the same descending sort the engine uses. This makes replay equivalent to replaying
the text, not the edit history.

## Health

```ts
interface EngineHealth {
  state: EngineProcessState;
  version?: string;
  protocol: number;
  pid?: number;
  uptimeMs: number;
  restarts: number;
  openDocuments: number;
  pendingRequests: number;
  memoryBytes?: number;
  lastError?: string;
}
```

Memory uses `fs.readFile('/proc/<pid>/status')` and parses `VmRSS`; other platforms
leave it undefined. Reporting it never blocks a request.

## Command

`arxmlScope.showEngineStatus`:
- gets `health()`, writes a small aligned block to an `OutputChannel` named
  `ARXML Scope Engine`;
- shows `showInformationMessage('Engine running (pid …)')` or the error;
- offers `Restart Engine` and `Open Output` choices.

The status bar item text is `$(pulse) ARXML Engine` (running), `$(sync~spin) ARXML
Engine` (restarting), `$(error) ARXML Engine` (failed); tooltip has the last error.

## Tests

- `src/test/engine/engineSupervisor.test.ts` (plain mocha, no VS Code):
  fake `EngineSpawner` returns a client-like object; simulate `exit`; assert replay
  calls, stable ids, pending rejection, give-up and disposal.
- `src/test/extension/engine.test.ts`: real engine; kill `client.child` via a test
  hook or request a restart, then open a doc and assert it survives.
- Status command formatting is a pure function; unit-test it.
