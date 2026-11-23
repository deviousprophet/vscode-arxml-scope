# Implementation plan — open the ECUC editor before indexing finishes

## Phase 0 — Measure before changing

- [ ] Add temporary `[INDEX-OPEN]` marks listed in `design.md` §7.
- [ ] Run on the representative workspace (many `.arxml` files) and the large sample.
- [ ] Record baseline numbers for: activation, engine resolve, index start/finish, command
      start, resolve start/end, page ready, first push, `buildRows`, engine open.
- [ ] Identify whether the dominant wait is activation, index CPU, first `buildRows`, or webview
      boot. Write the conclusion in the task notes.
- [ ] Stop if the dominant wait is `resolveEngine`; that needs a separate engine-startup task.

## Phase 1 — Readiness and completion contract

- [ ] Extend `DefinitionSource` with optional `isReady?()` and `onDidFinishRebuild?()`.
- [ ] Implement both in `IndexService`:
  - [ ] `hasSnapshot` flag set after `replaceAll`, cleared on disable;
  - [ ] listener set, notified once after `runRebuild` settles;
  - [ ] notify after disable/clear;
  - [ ] no per-file notification from the settle event.
- [ ] Add unit tests for readiness, settle-once, disable and failed rebuild.

## Phase 2 — Provider fast path

- [ ] `rowOptions(key, includeIndex = true)` skips definitions, candidate counts and reference
      resolvers when the index is not ready.
- [ ] `push(includeIndex?)` uses the readiness flag.
- [ ] `handleReady` keeps the immediate first push; it must not wait for a timer or the index.
- [ ] On `onDidFinishRebuild` with `isReady()` true, coalesce one enriched push.
- [ ] Convert the existing `definitionSource.subscribe(...)` push to the coalesced scheduler.
- [ ] Track `lastPushUsedIndex` and skip a redundant enriched push when the first push already
      included a usable index.
- [ ] A failed first build and a disabled index leave the base rows and never block.
- [ ] Do not await `IndexService.rebuild()` or any index readiness in the open path.
- [ ] Tests:
  - [ ] first document without definitions;
  - [ ] exactly one enriched document after the finish event;
  - [ ] no enriched push when finish is not ready;
  - [ ] already-ready open has one enriched push;
  - [ ] selection survives the enrichment;
  - [ ] local draft survives the enrichment.

## Phase 3 — Host responsiveness

Only after Phase 0 evidence:

- [ ] Schedule `IndexService.start()`'s first `rebuild()` on a later macrotask.
- [ ] Add cooperative yields in `collectRebuildFiles` at a time/file budget.
- [ ] If `replaceAll` dominates, batch the snapshot application with one final notify.
- [ ] Keep the index result and the memory-only contract unchanged.
- [ ] Add a test that the settle event still fires exactly once after batching/yielding.

## Phase 4 — Verification

- [ ] Remove temporary instrumentation (or put it behind a debug setting).
- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] Focused tests:
  - [ ] indexService
  - [ ] ecucEditorProvider / activation
  - [ ] editor page enrichment
- [ ] `npm test`
- [ ] `npm run shots:webview`
- [ ] `node esbuild.js --production`
- [ ] Re-run the Phase 0 measurement and record the after numbers.
- [ ] Manual check with `arxmlScope.index.enabled = false`: editor opens and renders.
- [ ] Manual check with a forced slow index (test hook): rows appear before the spinner stops;
      definitions arrive later; selection/scroll/draft preserved.

## Review gates

- [ ] The editor tab/shell does not wait for the workspace index.
- [ ] The first row document is built from the file itself.
- [ ] Definitions are optional and additive; no warning for a missing definition.
- [ ] Exactly one enriched push per settled build.
- [ ] Failed/disabled indexing leaves the editor usable.
- [ ] Indexing does not starve the extension host.
- [ ] No persisted index/cache or protocol change.
- [ ] No duplicate refresh path; `definitionSource.subscribe` and the finish event are coalesced.

## Rollback

- [ ] Revert the readiness/enrichment and scheduler changes only. The editor returns to the
      current behavior of using the live (possibly incomplete) index.

## Ordering

- [ ] Start after `.trellis/tasks/11-23-direct-edit-string-shortname` is finished, so the
      editor provider/preview changes do not overlap.
