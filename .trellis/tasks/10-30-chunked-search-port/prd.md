# Port the chunked search engine and search UX to the ECUC tree

## Goal

Replace the current synchronous ECUC row search with a chunked, cancellable engine modelled on the
reference search engine, and make the search UX behave the same way: explicit Enter/run search,
streaming progress and count, first-match jump as soon as a match is found, instant next/previous
navigation over completed matches, all-match plus current-match highlighting, a busy indicator, and
query invalidation when the typed text diverges.

The engine searches ECUC row text (label, short name, value), not raw ARXML bytes: the rows are the
product's search surface, and a byte engine would not map hits back to ECUC nodes. The performance
model is copied exactly: 120 ms debounce, 24 ms time slices, generation-token cancellation, throttled
progress, and index-only navigation after completion.

## Confirmed facts

- `src/editor/treeQuery.ts` has `haystack` and a synchronous `searchRows(rows, query)` that scans
  every row in one call.
- `renderHtml.ts` currently runs `refreshSearch` synchronously on Enter; the input handler only
  invalidates old results.
- Jumping already expands ancestors, scrolls, selects and keeps focus in the Search input.
- Highlighting uses `--match-bg` / `--match-hi`; the rendered page was verified in Chromium with
  all-match and current-match tiers.
- The reference engine (`SearchEngine` in the reference repository) uses:
  - `SEARCH_DEBOUNCE_MS = 120`
  - `SEARCH_CHUNK_BUDGET_MS = 24`
  - `SEARCH_PROGRESS_THROTTLE_MS = 150`
  - a generation token and debounce/chunk handles
  - `onProgressUpdate(matches, percent)` and `onComplete(matches)`
  - a first streaming match jump and a completed match index preserved by address
  - index-only `nextMatch`/`prevMatch` with wraparound
- The reference search bar runs on Enter or the run button, keeps the input behaviour independent,
  shows a busy spinner, count, previous/next and clear.

## Requirements

- **R1 Chunked engine.** A row-search engine must scan in time-budgeted slices (24 ms) with a small
  row batch between clock checks. It must yield to the event loop between slices so a large file
  cannot freeze the webview.
- **R2 Cancellation.** Starting a new query or clearing search must invalidate the previous run; a
  stale run must never update the count, highlights or selection.
- **R3 Debounce and progress.** Start after a 120 ms debounce, emit progressive matches at most about
  every 150 ms, and always emit the final matches on completion.
- **R4 Streaming UX.** As soon as the first match arrives, jump to and select it. Update the count
  while scanning. Show a busy indicator until completion. On completion, keep the current match by
  row id where possible.
- **R5 Enter/run navigation.** Typing alone does not search. Enter on a changed query starts a search;
  Enter on the active/completed query moves to the next match; Shift+Enter moves backwards. The
  previous/next buttons and F3/Shift+F3 do the same. Navigation only changes an index and jumps; it
  never re-scans.
- **R6 Highlighting.** Every match is marked in the tree, and the current match's row remains visually
  stronger. Streaming matches appear as they are found. Clearing search removes both.
- **R7 Divergence.** Editing the query after a run invalidates the old matches and busy state until
  the next Enter/run.
- **R8 Re-scan.** A document re-scan restarts the active query against the new rows and preserves the
  current match by row id where possible. A pending typed-but-not-run query does not search.
- **R9 Performance.** A synthetic large row set (at least 100k rows) must complete without blocking
  the page for more than the chunk budget and within a documented test threshold; navigation after
  completion must be O(1) index math.
- **R10 Constraints.** No new dependency, no file write, no inline style, no DOM-wide row scan per
  match. Only the virtual window is rendered.

## Acceptance criteria

- [ ] **AC1** A 100k+ row search yields in chunks and completes within the performance test threshold.
- [ ] **AC2** Starting a new query cancels the old run; the old completion callback never runs.
- [ ] **AC3** The first found match is selected and scrolled into view before the full scan completes.
- [ ] **AC4** The count updates progressively and settles at `current / total`.
- [ ] **AC5** Enter/Shift+Enter and the previous/next buttons move between matches instantly without
  re-running the search; navigation wraps.
- [ ] **AC6** Every match is highlighted, the current match is stronger, and both update during
  streaming and on navigation.
- [ ] **AC7** Typing a different query clears the old marks/count/busy state until Enter runs it.
- [ ] **AC8** A re-scan keeps the current match by id where possible and does not block the page.
- [ ] **AC9** Existing Conditions, Details, diff, notice and accessibility behaviour is unchanged.
- [ ] **AC10** `check-types`, `lint`, `test` and `package` pass; no dependency, file write, inline
  style or undocumented colour literal is added.

## Out of scope

- Byte, address or endianness search modes; ECUC search remains text over rows.
- A Web Worker; the reference uses time-sliced main-thread chunks.
- Persisting the query across reloads.
- Changing the Details, Conditions or diff surfaces.
