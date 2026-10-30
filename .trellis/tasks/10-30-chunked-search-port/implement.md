# Implement — Chunked ECUC row search

## Checklist

- [x] **1. Add the engine**
  - Create `src/editor/rowSearch.ts` with `RowSearchEngine`, handlers/options and `rowSearchScript()`.
  - Mirror 120 ms debounce, 24 ms budget, 150 ms progress throttle, 512-row batch and token
    cancellation.
  - Match on the pre-lowercased `TreeRow.haystack`; return row indices.
  - Add a performance test with 100k+ rows and a cancellation test.
- [x] **2. Wire the page**
  - Import/serialize the engine; instantiate it in the page.
  - Replace `refreshSearch`/`searchCandidates`/`firstMatchAtOrAfterSelection` with `startSearch`
    and engine handlers.
  - `executeSearch` starts a changed query, otherwise cycles.
  - `cycleSearch` only moves the index and jumps.
  - Input divergence clears the engine/results; re-scan restarts immediately with the previous id.
- [x] **3. Add the busy UX**
  - Add `#search-busy` to the toolbar and a theme-token spinner.
  - Show it while running; hide on complete/cancel.
  - Keep the count progressive and `current / total`.
- [x] **4. Preserve highlighting and jump**
  - Keep `--match-bg` / `--match-hi`, `data-search-current`, `jumpToSearchMatch`.
  - First streamed match jumps once; completion preserves the current row by id.
- [x] **5. Rewrite tests**
  - Add `rowSearch.test.ts`.
  - Update `search.test.ts` for engine start/cycle/cancel, busy and highlight.
  - Update page-string tests that mention `refreshSearch`, `searchCandidates` or `searchRows` in the
    page.
  - Add a large-row performance assertion.
- [x] **6. Validate**
  - `npm run check-types`
  - `npm run lint`
  - `npm test`
  - `npm run package`
  - Headless Chromium: type a query (0 marks), Enter (streamed marks/count), Enter again (selection
    and current mark move), Shift+Enter (previous), clear (0 marks).
  - Extension Development Host manual pass if available.

## Validation commands

```powershell
npm run check-types
npm run lint
npm test
npm run package
```

## Review gates

- After step 1: run the engine tests and the 100k performance test.
- After step 2: confirm typing does not start a scan (`searchEngine.search` only from Enter/re-scan).
- After step 3: confirm busy turns off on complete, cancel and clear.
- Before commit: full suite, package and headless probe.

## Result

- Engine: `RowSearchEngine` with 120 ms debounce, 24 ms slices, 512-row batches, 150 ms progress
  throttle and generation-token cancellation.
- New `rowSearch.test.ts`: matches, progress, cancellation, timing constants and a 150k-row
  completion test all pass.
- Headless Chromium: typing `Cont` produced 0 marks/count; Enter showed the busy spinner and
  `0 / 0`, then settled at `1 / 4` with 8 marks; Enter moved to `2 / 4` with the selection/current
  row changing; Shift+Enter returned to `1 / 4`; editing the query cleared all marks.
- Full suite: 372 passing. Page boot remains clean.
- Extension Development Host manual pass remains unverified in this environment.

## Rollback

- Remove `rowSearch.ts` and restore the synchronous `refreshSearch`/`searchCandidates` path.
- The page wiring is one block in `renderHtml.ts`; the fixed highlight CSS and jump helper stay.
- Busy UI is one toolbar span + CSS rule.
