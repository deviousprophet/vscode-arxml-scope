# Design — Chunked ECUC row search

## 1. Engine boundary

New pure module `src/editor/rowSearch.ts`:

```ts
export interface RowSearchHandlers {
  onProgressUpdate?(matches: number[], percentComplete: number): void;
  onComplete(matches: number[]): void;
}

export interface RowSearchOptions {
  debounceMs?: number;
  budgetMs?: number;
  progressMs?: number;
  batchSize?: number;
  immediate?: boolean;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class RowSearchEngine {
  search(rows: readonly TreeRow[], query: string, handlers: RowSearchHandlers, options?: RowSearchOptions): void;
  clear(): void;
}
```

Defaults mirror the reference engine: debounce **120 ms**, chunk budget **24 ms**, progress throttle
**150 ms**, batch **512 rows**, and a generation token. The class keeps two timer handles (debounce
and next chunk). `clear()` bumps the token and clears both. `search()` cancels the previous run,
treats a blank query as `onComplete([])`, and schedules `runChunked` after the debounce unless
`immediate` is set.

`runChunked`:

1. Lower-cases/trims the query once.
2. Scans at most `batchSize` rows between clock checks.
3. After each batch, checks `now() >= deadline`; if not, scans another batch inside the same slice.
4. Emits `onProgressUpdate(matches.slice(), percent)` at most every `progressMs`, always on
   completion.
5. Yields with `setTimer(step, 0)` while rows remain; a stale token exits without callbacks.
6. On completion emits progress 100 then `onComplete(matches.slice())`.

Matches are row indices, so the page can map them to row ids and jump without re-scanning.

`rowSearchScript()` serializes:

```ts
`${RowSearchEngine.toString()}`
```

The class body only references its own methods, injected timer/clock functions (defaults installed
in the constructor) and the `TreeRow.haystack` field, so the serialized copy is self-contained.

`treeQuery.searchRows` stays as the small synchronous reference matcher used by unit tests and
comparisons; the page no longer serializes it.

## 2. Page integration

`renderHtml.ts` imports `RowSearchEngine` (type) and `rowSearchScript`, emits it before the page
script, and instantiates `const searchEngine = new RowSearchEngine();`.

State added:

```text
searchRunning        true between search start and completion/cancel
searchFirstJumpDone  the streaming first match has been selected
searchPreviousId     row id to preserve across progress/completion/re-scan
```

The existing `searchQuery` is the committed query and `highlightQuery` is the mark query.

`startSearch(query, previousId?, immediate?)`:

- cancel the engine, reset `searchMatches`/`searchIndex` unless a previous id is being preserved;
- set `searchQuery`, `highlightQuery`, `searchRunning = true`, `searchFirstJumpDone = false`;
- set the busy indicator;
- call `searchEngine.search(rows, query, handlers, { immediate })`.
- On progress:
  - capture the current row id, replace `searchMatches` with the streamed matches;
  - if no first jump has happened and matches exist, set index 0 and jump once;
  - otherwise keep the current match by id or clamp the index; repaint count/marks.
- On complete:
  - set `searchRunning = false`, clear the busy indicator;
  - preserve the current match by id (or the previous id from a re-scan), else the first match;
  - jump once and repaint the count.

`executeSearch()` on Enter:

- blank → clear;
- typed value different from `searchQuery` → `startSearch(value)`;
- same query → `cycleSearch(shift ? -1 : 1)`.

`cycleSearch` only changes `searchIndex` with `stepMatch` and calls `jumpToSearchMatch`; it never
starts a scan. `input` on a diverged query calls `searchEngine.clear()` and `resetSearchResults()`.
`setRows` restarts the committed query with `immediate: true` and the previous match id, so a
document re-scan does not wait for the debounce.

A small `#search-busy` spinner is shown while `searchRunning`; it uses theme progress tokens and is
removed from layout when idle. The count remains `current / total`, as in the reference UI.

## 3. Highlighting and jump

Existing fixed tiers stay:

- all matches: `--match-bg` (rgba(234, 179, 8, 0.32));
- current match: `--match-hi` (rgba(234, 179, 8, 0.7));
- `data-search-current` on the row that owns `searchIndex`.

`jumpToSearchMatch` already expands ancestors, scrolls, selects and keeps focus in the input. It is
called on the first streamed match and on completion/navigation, never on every progress tick. The
rendered window is the only DOM rebuilt.

## 4. UX contract (reference parity)

| Action | Behaviour |
|---|---|
| Type | Field and clear X only; no scan, marks, count or jump |
| Enter, changed query | Start debounced chunked search |
| Enter, active/completed query | Next match (instant, wraps) |
| Shift+Enter | Previous match (instant, wraps) |
| Prev/Next buttons | Same as Shift+Enter/Enter |
| F3 / Shift+F3 | Same while a committed query exists |
| Clear X / Escape | Cancel engine, clear query/marks/count/busy |
| Ctrl+F | Focus and select the Search field |
| Document re-scan | Restart committed query immediately, preserve current row by id |

## 5. Tests

- New `src/test/editor/rowSearch.test.ts`:
  - small matches, blank query, case-insensitive row haystack;
  - cancellation: query A then query B, A never completes;
  - progress: a large set emits progress and the final complete matches;
  - performance: 100k synthetic rows with a match near the end completes under a documented
    threshold and without per-row clock checks;
  - serialized class is present in `renderHtml`.
- `search.test.ts`:
  - remove `refreshSearch`/`searchCandidates` harnesses;
  - assert `executeSearch` starts the engine, Enter on the same query cycles, input divergence
    cancels;
  - keep the jump/focus and count tests;
  - assert the busy element and fixed highlight tiers.
- `virtualPage/rescan` page-string tests update for `startSearch` and engine restart.
- Headless Chromium: type a multi-match query, report workspace; verify typing has 0 marks, Enter
  streams matches, first/next/previous move the selected and current rows, and the two yellow tiers
  are visible.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Engine copy drifts from the reference timing | Constants and chunk structure are explicit and tested. |
| Progress callbacks thrash the DOM | Progress is throttled to 150 ms and only the virtual window is rebuilt. |
| Stale run updates a new query | Generation token checks before every callback and before scheduling. |
| Re-scan blocks the page | `immediate` only skips the debounce; the scan is still chunked. |
| Current match jumps while streaming | Only the first match jumps during progress; navigation is user-driven. |
| Per-row clock overhead | Batch 512 rows between `performance.now()` checks. |
