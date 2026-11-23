# Design — open the ECUC editor before indexing finishes

## 1. Current open path (facts to verify)

```text
activate()
  ├─ await resolveEngine()                    ← activation gate
  ├─ new IndexService(); indexService.start() ← fire-and-forget full rebuild
  ├─ registerTextFeatures(...)
  ├─ new EcucEditorProvider(..., indexService)
  └─ registerCustomEditorProvider(...)

openEcucEditor → vscode.openWith → resolveCustomTextEditor()
  ├─ gate
  ├─ scanEcucValues(document.getText())       ← synchronous document scan
  ├─ panel.webview.html = editorShell(...)    ← shell is set immediately
  ├─ subscribe to document/config/index changes
  ├─ session.engineOpening = openEngineDocument(...) ← not awaited
  └─ page posts `ready`
        └─ session.push()
              └─ buildRows(model, rowOptions(key))
                    └─ definitions: (ref) => index.definition(ref)
```

The index is optional and additive by design
(`.trellis/spec/frontend/quality-guidelines.md`). The provider already treats a missing
definition as "no definition rows", so the first paint does not need a complete index.

The reported wait can come from four places. The task must measure before changing structure:

1. **Activation / `resolveEngine`.** VS Code cannot invoke the contributed command until
   `activate()` resolves. The engine handshake is required; if it dominates, that is a separate
   engine-startup problem.
2. **Index rebuild event-loop pressure.** `IndexService.start()` schedules
   `collectRebuildFiles()` (async reads, synchronous XML indexing per file) and a final
   synchronous `WorkspaceIndex.replaceAll()`. A large workspace can starve the extension host
   while the editor is opening.
3. **Provider first push.** `session.push()` on `ready` builds every row with
   `definitions`/`definitionCandidateCount`/`referenceResolver` from the live index. The
   `buildRows` call is synchronous.
4. **Webview boot.** The shell is static; the tree appears after the page bundle mounts and
   the first `document` arrives. A long empty shell reads as "still indexing".

## 2. Target behavior

- The editor tab and shell appear without waiting for `IndexService.rebuild()`.
- The first row document is built from the file itself. It may omit workspace definitions.
- While the index has no usable snapshot:
  - `buildRows` receives no `definitions`, no `ambiguousDefinitions` and no
    `referenceResolver`;
  - definition rows are absent from Details (the existing behavior for a missing definition);
  - the Document still renders labels, values, conditions and formats.
- When the index finishes (success, failure or disable), one coalesced enrichment push updates
  the open panels. Selection, scroll, collapsed rows and local drafts are preserved.
- If the index was already usable when the panel opened, the first push is already enriched and
  no second push is needed.
- Indexing may keep the status bar spinner; it must not block the editor or spam the panel.

## 3. Index readiness contract

Extend the optional `DefinitionSource` surface in `src/host/ecucEditorProvider.ts`:

```ts
export interface DefinitionSource {
  definition(definitionRef: string): DefinitionInfo | undefined;
  definitionCandidateCount?(definitionRef: string): number;
  subscribe(listener: () => void): { dispose(): void };
  resolveTarget?(...): ElementResolution;
  referencesFor?(...): IndexReference[];

  /** True when the current snapshot is complete enough to enrich rows. */
  isReady?(): boolean;
  /** Fires once after each rebuild settles (success, failure or disable). */
  onDidFinishRebuild?(listener: () => void): { dispose(): void };
}
```

`IndexService` implements both:

- `isReady()` is `true` once a snapshot has been applied (`replaceAll`) and remains true during
  a later rebuild (the previous snapshot is still usable); `false` before the first snapshot
  and after `clearDisabledIndex()`.
- `onDidFinishRebuild` listeners run in `runRebuild`'s `finally`/`finishBuilding`, after the
  building flag is cleared, and after a disable. They do not run per file.
- The existing `subscribe()` remains the per-change signal for already-open panels. The new
  event is only the "settled" signal.

Tests and fakes keep compiling because both members are optional.

## 4. Provider fast path

### 4.1 Row options without the index

Change `rowOptions` to accept a readiness flag:

```ts
private rowOptions(key: string, includeIndex = true): RowBuildOptions {
  const base = { ...editorSettings(), conditions: this.conditionValues() };
  const source = this.definitionSource;
  if (source === undefined || !includeIndex || source.isReady?.() === false) {
    return base;
  }
  return {
    ...base,
    definitions: (ref) => source.definition(ref),
    ...definitionExtras(source, key)
  };
}
```

`push` chooses the flag from `source.isReady?.() !== false`. The result is the same row shape
with `definition` omitted; no page contract change.

### 4.2 One enrichment after the first build

In `resolveCustomTextEditor`:

```ts
const finish = this.definitionSource?.onDidFinishRebuild?.(() => {
  session.schedulePush(true);
});
if (finish !== undefined) disposables.push(finish);
```

Add a small coalescer so the first build, watcher updates and config changes cannot post a
storm:

```ts
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pushIncludesIndex = false;

const schedulePush = (includeIndex: boolean): void => {
  pushIncludesIndex ||= includeIndex;
  if (pushTimer !== undefined) return;
  pushTimer = setTimeout(() => {
    pushTimer = undefined;
    const include = pushIncludesIndex;
    pushIncludesIndex = false;
    push(include);
  }, 0);
};
```

Rules:

- `handleReady` calls `schedulePush(false)`? No: it should push immediately with the current
  readiness so the first paint is not delayed by a timer. `session.push()` remains the direct
  first-paint path.
- `onDidFinishRebuild` calls `schedulePush(true)` only when `isReady()` is true.
- The existing `subscribe(() => push())` becomes `schedulePush(true)` (or `false` while not
  ready) to coalesce watcher-driven rebuilds.
- Never schedule an enriched push if the last push already included the same index snapshot.
  A simple `lastPushUsedIndex` flag plus `isReady()` is enough; the exact snapshot identity is
  not required because the index subscription already signals changes.
- A failed first build leaves `isReady()` false; the completion event does not push, the editor
  stays on base rows, and the user can still edit.
- If the index is disabled, `isReady()` false; no enrichment. If re-enabled, the rebuild's
  finish event pushes enriched rows.

### 4.3 Preserve panel state

`applyRows` already captures/restores the cursor and view state and overlays local drafts. The
enrichment push uses the same `document` message, so selection (host `selections` map), scroll,
collapse and drafts survive. Add a test that types a local draft before the enrichment and
asserts it is still visible after.

## 5. Keep the host responsive while indexing

Only do this where measurement shows a problem. Prefer the smallest compatible change:

1. **Defer the first start one macrotask.** `IndexService.start()` should schedule the first
   `rebuild()` with `setImmediate`/`setTimeout(0)` so activation and provider registration
   finish first. The rebuild remains fire-and-forget.
2. **Yield between files.** In `collectRebuildFiles`, after each read/parse or every N files
   (for example 8 ms of work), `await new Promise<void>((resolve) => setTimeout(resolve, 0))`.
   The index result is unchanged; only scheduling changes.
3. **Chunk the snapshot swap if needed.** `WorkspaceIndex.replaceAll` is synchronous. If it
   blocks the host for more than a frame on the representative workspace, add a batched
   `replaceAll`/`beginReplace` + `upsert` + `endReplace` path that notifies once at the end.
   Do not change the index semantics or add persistence.

Do not move indexing into a worker in this task; a worker changes the `vscode` boundary and
needs a separate design.

## 6. Activation and engine

`activate()` awaits `resolveEngine` before registering the provider. That is the documented
contract, and the engine is required. Measure it; if it is the dominant wait, record it and
open a separate task rather than weakening the activation contract here. The provider already
opens the engine document without awaiting it (`session.engineOpening`), so an accepted edit
can wait for the engine while the page and TS model are usable.

## 7. Measurement plan

Add temporary `performance.now()` marks (tagged `[INDEX-OPEN]`) or a debug-only timing object:

| mark | where |
| --- | --- |
| activate start/end | `extension.ts` |
| resolveEngine start/end | before/after `await resolveEngine` |
| index start/end/finish | `IndexService.start` / `runRebuild` |
| command start | `openEcucEditor` |
| resolve start/end | `resolveCustomTextEditor` |
| page ready | `handleReady` |
| first push start/end | `push` / `buildRows` |
| enriched push | completion listener |
| engine open | `openDocument` |

Run on:
- the sample workspace with many indexed `.arxml` files;
- one large document (the 1,100-parameter fixture or larger);
- index enabled, disabled, and forced slow (test-only reader delay).

Record the baseline and the target in the task notes. Remove the instrumentation before the
fix commit, or keep it behind an explicit debug setting if it is useful.

## 8. Tests

- Provider with a fake `DefinitionSource`:
  - `isReady()` false → first `document` has rows and no `definition`;
  - fire `onDidFinishRebuild` after setting ready → exactly one enriched `document` with the
    same `selectedId`;
  - not ready on finish → no push;
  - already ready on open → one enriched push and no second;
  - local draft survives enrichment (page-level or provider message assertion).
- IndexService:
  - `start()` does not rebuild synchronously;
  - `isReady()` false → true after a successful snapshot; false after disable;
  - `onDidFinishRebuild` fires once per settle, not per file;
  - a read failure still fires the settle event and leaves the previous snapshot alone.
- Optional integration timing test with a slow reader: first push happens before the finish
  event; assert ordering, not wall-clock thresholds (CI-safe).
- Existing activation/editor tests and the full suite.

## 9. Rollback

- Revert the readiness/enrichment push and the indexing scheduler changes. No protocol,
  persisted format or index schema changes. The editor returns to building rows with the
  current (possibly partial/empty) index.
