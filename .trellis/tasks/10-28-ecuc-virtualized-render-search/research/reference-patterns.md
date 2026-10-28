# Reference patterns for virtualized ECUC rendering

Reference repo (read-only, separate project): `D:\workspace\vscode-hex-scope`.

## What was inspected

- `src/webview/render/virtualScroll.ts` — pure virtual-scroll math: cumulative row heights,
  `calcVisibleRange` with a viewport-sized overscan, total/offset/range heights, and a compressed
  physical-scroll mode for very tall content. Unit-tested in
  `src/test/webview/virtualScroll.test.ts`.
- `src/webview/memory/memoryGrid.ts` — windowed slice renderer: top/bottom slice placement, only
  visible rows in the DOM, scroll invalidation, visible-match paint, selected row scroll/reveal.
- `src/core/search.ts` — `SearchEngine`: 120 ms debounce, 24 ms chunk budget, progress throttling,
  cancellation token, streaming matches.
- `src/webview/search/searchEngine.ts` — UI glue: generation/clear, progress, complete,
  next/previous, scroll to match.
- Tests: `src/test/webview/virtualScroll.test.ts`, `src/test/core/searchPerformance.test.ts`,
  `src/test/webview/searchEngine.test.ts`.

## Patterns worth adapting

1. **Pure math first.** Keep row-range/offset/total calculations in a pure module with unit tests; the
   DOM layer only applies the result.
2. **Window, not hide.** Render only the visible slice plus overscan; spacers preserve total height.
3. **Debounce and cancel.** Search/filter input starts a new generation; stale results are dropped.
4. **Visible-only match painting.** Keep the match index separate; paint/highlight only rendered rows.
5. **Deterministic heights.** The reference uses a row-height getter/cache; we can use fixed Document
   heights and two fixed Tree heights because the ECUC row shapes are known.
6. **Scroll/focus state.** Preserve the selected/revealed row by index/id; recompute the window after
   scroll/collapse/filter/data replacement.

## What does not transfer

- The hex grid is flat; ECUC is a collapsible tree with two presentations, prose metadata and a value
  editor. We need a flattened visible-row model (`parentId`/`subtreeSize`) and flat-tree ARIA.
- The hex grid has no `role=tree`; ECUC must keep tree semantics and a rendered focused row.
- The hex search scans bytes; ECUC filters normalized label/short/value haystacks and keeps ancestor
  rows. A Web Worker is out of scope; the 12k string scan is cheap, the DOM is the bottleneck.
- Do not copy code or CSS from the reference; use the patterns only.

## Current baseline (ECUC, Document dark, harness)

| Sample | Rows | DOMContentLoaded | load | filter |
|---|---|---|---|---|
| `sample/large` | 4,001 | 717 ms | 823 ms | 55.7 ms |
| `sample/huge` | 12,001 | 3,838 ms | 3,855 ms | 102.4 ms |

The full tree plus 12k line-number pseudo-elements is the load/lag cause; the filter scans/toggles
the full DOM too.
