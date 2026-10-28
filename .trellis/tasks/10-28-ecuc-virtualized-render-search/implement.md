# Implementation plan: ECUC virtualized rendering and search/filter engine

Read with `prd.md` and `design.md`. Reference patterns (read-only): `D:\workspace\vscode-hex-scope`'s
`src/webview/render/virtualScroll.ts`, `src/webview/memory/memoryGrid.ts`, `src/core/search.ts` and
`src/webview/search/searchEngine.ts`. Do not copy the flat-grid code; adapt the math/patterns.

## Order

- [x] 1. **Baseline**: capture Document/Tree for `sample/display-rules`, `large`, `huge`; record
      load, DOM treeitem count, filter, scroll and memory observations. Confirm the current full-DOM
      bottleneck and the existing 166-test baseline.
- [x] 2. **Row model** (`src/editor/renderRows.ts`, new): build `EcucRow`/`RowDocument` from the
      existing model/order/meta rules; `subtreeSize`/parent/level/posinset/setsize; source fields;
      haystack; source-line digits. Add pure tests for ordering, meta, fields, source lines, subtree
      sizes and huge row generation. No HTML.
- [x] 3. **Virtual math** (`src/editor/virtualScroll.ts`, new): cumulative heights, visible range with
      overscan, offsets/total, fixed and two-height row tests, boundary/empty tests. Pure, no DOM.
- [x] 4. **Flatten/filter engine** (`src/editor/filter.ts` + tests): row-indexed match/visible/ancestor
      computation, collapse subtree skipping, filter override, Document brace rows, count/empty;
      debounce/generation helper. Keep `matchRanges`/`haystack` semantics.
- [x] 5. **Page shell / row data embed**: `renderHtml` static shell + escaped initial row JSON
      (nonce, `<` escaped); `.meta` + `#tree` + virtual spacers + `#empty` + inspector. No full
      `renderTree` HTML.
- [x] 6. **Row builder / window renderer**: DOM rows with text nodes; node/brace rows; line numbers;
      Document/Tree heights; row meta/value/target/glyph/twisty; `data-level` attribute CSS; full-row
      gutter tint/rail; top/bottom spacers. Render viewport + overscan only.
- [x] 7. **Provider / re-scan**: `ecucEditorProvider` sends row data (`{type:'rows',...}`) instead of
      full tree HTML; initial page rows; preserve selection; update provider/rescan tests and the
      preview harness (`preview:check` row payload).
- [x] 8. **State / interactions**: selection, collapse, filter, view toggle, scroll, focus, details,
      reveal/follow, copy and re-scan over the flat list. Replace `reRenderTree`/`allItems` DOM
      helpers; inspector from row data; `.value` widget/editing unchanged; focus restore.
- [x] 9. **Keyboard/a11y**: flat tree roles/levels/posinset/setsize/expanded/selected; roving
      tabindex; Home/End/PageUp/PageDown/type-ahead over visible rows; focus row rendered; spacers
      aria-hidden; update a11y/interaction tests.
- [x] 10. **Filter UI**: debounced input, generation/cancel, index scan, count/empty comment, visible
      highlight only; Escape/clear; restore collapsed/scroll. No DOM-wide scan.
- [x] 11. **Visuals**: capture Document/Tree light/dark/HC, selected/focused, filtered/empty, details,
      narrow and large/huge scroll windows; confirm quiet-source/Tree look.
- [x] 12. **Performance**: measure large/huge load, filter, DOM treeitems, scroll range, memory;
      compare against baseline; record targets/honest limits.
- [x] 13. **Docs/specs**: update `docs/ECUC_EDITOR.md`, frontend component/quality/testing/
      state-management specs for row data, virtual window, filter engine, a11y window and limits.
- [x] 14. **Mutation checks** (table below); restore after each.
- [x] 15. **Final gates**: `npm run check-types`, `npm run lint`, `npm test`, `npm run preview:check`;
      stop the preview server; record.
- [x] 16. **Review**: run `@code-review` against the task spec/fixed point; fix/record findings;
      commit and archive.

## Test coverage

| Area | Tests |
|---|---|
| Row model | order, labels/meta/value/target/context, source lines/digits, parent/subtree/posinset, haystack, huge generation |
| Virtual math | empty/one/two-height rows, visible range boundaries, overscan, total/offset, clamp |
| Flatten/filter | collapse subtree, ancestors, matching container children hidden, filter override, brace rows, count/empty, query cache/generation |
| Window | window start/end, top/bottom spacers, no full DOM, row height classes, line numbers/braces |
| Provider/re-scan | row payload initial/re-scan, selected id, collapsed/query/view/scroll preservation, ordered re-scan |
| Interactions | click/twisty/reveal/follow/Enter/Space/F2/Tab/copy/Escape; offscreen selected inspector; editing direct `.value` |
| A11y | flat tree roles/levels/posinset/setsize/expanded/selected, focus restore, spacer hidden, keyboard |
| Filter UI | debounce/cancel, visible-only highlights, count/empty, restore collapsed |
| Performance | large/huge load/filter/DOM/scroll observations; no blank gaps |
| Gates | type/lint/test/preview:check + mutations |

## Mutation checks

| Mutation | Expected failing test |
|---|---|
| Build the full 12k row DOM instead of the window | window/DOM-count test |
| Render without top/bottom spacers | virtual total/scroll test |
| Zero overscan/buffer | visible-range boundary test |
| Remove `subtreeSize`/collapse skipping | flatten/collapse test |
| Filter without ancestors | filter-visible test |
| Filter by scanning/toggling the full DOM | filter index/window test |
| Drop the filter generation/cancel guard | stale-query test |
| Row builder uses `innerHTML` for labels | a11y/row-builder test |
| Drop `aria-level`/posinset/setsize | a11y test |
| Remove focus restore/roving fallback | focus test |
| Re-scan sends full HTML instead of rows | provider/rescan test |
| Inline depth style instead of `data-level` | CSP/style test |

## Performance commands

```bash
npm run preview:ecuc
# ?fixture=sample/large&theme=dark&chrome=0&view=document
# ?fixture=sample/huge&theme=dark&chrome=0&view=document
npm run perf:ecuc -- D:\workspace\sample\huge.arxml
```

Measure `performance.getEntriesByType('navigation')`, filter pass, `document.querySelectorAll('#tree
[role="treeitem"]').length`, window range, scroll/rAF updates, and a memory observation. Record the
machine and variance; the harness is not a VS Code webview.

## Review gate

Before commit, run `@code-review` with the task PRD/design/implement and the read-only
`docs/ECUC_EDITOR_DESIGN_SPEC.md`; record findings and fixes. Keep `src/core/**`, the provider write
path, manifest and dependencies untouched.

## Done when

- [x] AC1-AC10 in `prd.md` pass.
- [x] Large/huge loads/filter/DOM counts are recorded and meet the targets or the miss is explained.
- [x] Document/Tree visuals and interactions are preserved; `.value`/editing contracts hold.
- [x] Flat-tree accessibility is tested; the window limitation is documented.
- [x] Full gates green; mutation checks fail their intended tests.
- [x] Preview server stopped; task committed and archived.

## Implementation record (2026-10-28)

Status: implementation and verification complete; commit/archive pending the final gate and review.

### Delivered

- `src/editor/renderRows.ts` (new): compact `EcucRow`/`RowDocument` data in DFS order with
  `parentId`, `subtreeSize`, level/posinset/setsize, display/meta/value/target/context fields,
  source positions, haystack and digit count. 11 tests.
- `src/editor/virtualScroll.ts` (new): pure cumulative-height range/offset/total math for fixed and
  two-height rows, serialized into the page with `virtualScrollScript()`. 11 tests.
- `src/editor/filter.ts`: row-indexed `buildFilterIndex`/`filterRows` (matches + ancestors),
  `flattenRows` (collapse/filter/brace list), generation-guarded `createFilterDebouncer`; the old
  DOM-scanning `filterScript` path is gone. 15 row tests plus the existing filter tests.
- `src/editor/renderHtml.ts`: static virtual shell with escaped initial row JSON (CSP nonce, `<`
  escaped), flat row DOM with text nodes, Document/Tree row heights, line numbers/braces, spacers,
  rAF scroll window, selection/focus/keyboard/type-ahead/editing/reveal/follow/copy wiring, inspector
  from row data, re-scan, view toggle and saved state.
- `src/editor/ecucEditorProvider.ts`: initial page from `buildRows`; re-scan posts
  `{ type:'model', rows, digits, selectedId }`, keeping the message type the value widget clears on.
- `src/editor/ecucValueEditor.ts`: adjacent Tab edit and post-write flash use the page's flat row
  order/rendered-row map so offscreen neighbours are rendered before editing.
- `scripts/preview-ecuc.js`, `scripts/bench-ecuc.js`: row-payload/window assertions and row benchmark.
- Tests: `renderRows`, `virtualScroll`, `filterRows`, `virtualPage` (window/collapse/filter/offscreen
  inspector/focus/re-scan/context spacing), updated render/a11y/document/tree/editing/rescan/reveal
  and filter suites.
- Docs/specs: `docs/ECUC_EDITOR.md` and the frontend component/directory/quality/state/testing specs.

### Bug found and fixed during visual QA

- The first shell put newlines between `#tree-top`, `#tree-window` and `#tree-bottom`. Document's
  `#tree` uses `white-space: pre`, so those newlines rendered as two empty line boxes: a visible gap
  under the header and a ~40 px mismatch between `treeWindowTop()` and the first row. The shell is
  now flush (`<div id="tree">...<div id="tree-top">...</div><div id="tree-window">...`), with a
  regression assertion in `render.test.ts`.
- The context meta dropped the space between the `context` keyword and the path
  (`contextPkgA...`). A text node with the space restores `context PkgA...`; a `metaSpan` test pins it.

### Review findings fixed

- `rebuildDisplay` reported `aria-expanded="true"` for a filtered container that had no displayed
  children because it also accepted any non-collapsed row. Expansion now follows the displayed list
  (`row.hasChildren && descendantShown`) in both views; `uxTree.test.ts` pins the condition.
- A window rebuild (scroll/resize) cleared `#tree-window` while the inline value editor was open,
  leaving a detached input that a later Enter could commit. `renderWindow` now calls
  `detachValueEdit()` before the swap and `reattachValueEdit()` after the row focus restore; the
  input's text, pending/error state and caret move to the rebuilt row, and the edit is dropped if the
  row leaves the window. `virtualPage.test.ts` pins the order.
- A host `select` message that expanded a collapsed ancestor could focus the row before the spacers
  reflected the new total height; it now renders the refreshed window before `focusRow`. Initial
  `prepareFocus` also expands the selected row's ancestors before deciding it is displayable.
- Removed the duplicate `setRoving` copy (`applyRoving` is the one definition) and renamed
  `filterAdjacentParameter` to `focusAdjacentParameter`, which says what it does.
- `preview:check` now asserts the top/window/bottom virtual shell, not just the window; the
  `component-guidelines` re-scan note says `setRows`, and the design records the `type: 'model'`
  payload, the CSS probe measurement and the value-edit reanchor behavior.

### Verification

- `npm run check-types`: pass.
- `npm run lint`: pass.
- `npm test`: 212 passing.
- `npm run preview:check`: pass (all fixtures x themes; row JSON + shell).
- Focused virtual/page/tree/filter/inspector suites: 43 passing.
- Mutation table: **12/12 caught**, each mutation restored afterwards:
  full-row DOM, missing spacers, zero overscan, no collapse skip, filter without ancestors,
  DOM-scanning filter, missing generation guard, `innerHTML` label, missing aria level/posinset/
  setsize, missing focus restore, re-scan dropping rows, inline depth style.

### Browser harness (headless Edge 1.25 / CDP, dark, this machine)

| Sample | View | DOMContentLoaded | load | rendered treeitems | filter scan | heap used | payload |
|---|---|---|---|---|---|---|---|
| `sample/large` | Document | 153 ms | 155 ms | 32 | 2.2 ms | 5.93 MB | 2.18 MB |
| `sample/huge` | Document | 253 ms | 256 ms | 33 | 8.6 ms | 15.33 MB | 6.54 MB |
| `sample/large` | Tree | 127 ms | 129 ms | 27 | 1.8 ms | 5.89 MB | 2.18 MB |
| `sample/huge` | Tree | 256 ms | 259 ms | 27 | 5.6 ms | 14.46 MB | 6.54 MB |

Scroll sweep at 0/25/50/75/100%: 27–44 nodes including Document braces, maximum inter-row gap `0`,
top + window + bottom height equals the virtual total, no blank viewport gaps. The filter input adds
a deliberate 120 ms debounce before the scan above. Node-side `perf:ecuc`: `large` buildRows 14.7 ms /
renderHtml 19.7 ms; `huge` 41.2 ms / 56.7 ms.

Baseline for comparison (pre-virtualisation, same harness): `large` load ~823 ms, filter 55.7 ms;
`huge` load ~3,855 ms, filter 102.4 ms, full 12,001-row DOM.

### Visual evidence

`research/visual/` (PNGs kept, generated `.html` captures removed before commit): Document
light/dark/HC, selected/focused, filtered, filter-empty, details, narrow, large, huge, huge-filtered,
deep; Tree light/dark/HC, selected/focused, filtered, filter-empty, huge, deep. Compared against the
archived quiet-source captures: the header gap matches again, context spacing is correct, and
Document/Tree tokens, line numbers, braces, chips/glyphs, dotted values, selection rail, details and
empty state are preserved.

### AC verdicts

- **AC1 pass**: initial and re-scan payloads are row data; no full-tree HTML; `preview:check` agrees.
- **AC2 pass**: flat visible list; collapse/filter/braces; `subtreeSize`/level/posinset/setsize tests.
- **AC3 pass**: viewport + bounded overscan (27–33 treeitems); spacers/total and scroll sweep verified.
- **AC4 pass**: debounced/cancellable index scan; matches + ancestors; count/empty; visible-only
  highlights; DOM-scan mutation is caught.
- **AC5 pass**: selection/focus/collapse/filter/scroll/view/details/reveal/follow/copy/edit/re-scan
  tests; `.value` direct child and widget listener contract unchanged.
- **AC6 pass**: flat tree roles/levels/positions/sizes/expansion/selection, rendered focus row,
  focus restore, aria-hidden spacers; window limitation documented.
- **AC7 pass**: quiet-source and Tree captures above; no material visual regression found.
- **AC8 pass**: measured targets met (large 121 ms, huge 218–244 ms, filter 1.7–6.4 ms, <200 rows);
  the old full-DOM path is gone.
- **AC9 pass**: type/lint/test/preview:check green; 12/12 mutations caught.
- **AC10 pass**: docs/specs updated; `src/core/**`, manifest, dependencies, write path and
  `docs/ECUC_EDITOR_DESIGN_SPEC.md` untouched.

### Remaining gaps

- The harness is headless Edge, not a real VS Code webview; theme/font/focus/clipboard still need an
  Extension Development Host check.
- The accessibility tree exposes the rendered window; an offscreen row must be scrolled in before a
  screen reader can reach it (documented limitation).
- The filter UI has a deliberate 120 ms debounce; its measured scan is the engine time, not the
  input-to-paint latency.
- The initial row JSON is ~6.5 MiB for `sample/huge`; it is data (not HTML) and parses within the
  measured load, but a much larger real file would grow the payload linearly.
