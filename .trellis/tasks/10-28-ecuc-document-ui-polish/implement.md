# Implementation plan: ECUC Document-only UI polish and details editing

Read with `prd.md` and `design.md`. This is a follow-up to the archived virtual-render/search task;
keep the flat row model, filter/flatten engine and virtual window.

## Order

- [x] 1. **Baseline**: captured the Document/Tree states, the line-number gutter, global guides,
  inline value editing, the F2 hint and the Source/Copy actions; recorded the test count, payload,
  load/filter and DOM count. Confirmed the Tree and line-number code paths to delete.
- [x] 2. **Row payload simplification** (`renderRows.ts`, `renderHtml.ts` types): removed `digits`,
  `sourceLine/line/column/endLine/endColumn`, `lineIndex` from `RenderOptions`/`RowBuildOptions`/
  `RowDocument`/`RowPayload`; removed `sourceFields`/`maxLine`. Row tests updated.
- [x] 3. **Document-only shell and CSS**: removed the view toggle/markup/state; removed Tree CSS,
  row heights/probes, glyphs/chips, per-kind borders and `--tree-row-h*`; made the Document flex row
  the base; removed the line-number gutter, `--ln-*`/`--gut`, `data-line`, `data-ln-digits`, digits
  and the active-line-number rules; added `--doc-pad`/`--indent`/`--fold` geometry and the inline
  fold column; kept braces, tokens, selection tint/rail, metadata, details panel and empty/filtered
  states.
- [x] 4. **Collapse controls and twisty**: larger labelled toolbar Collapse/Expand buttons, a
  12px row twisty visible at rest, and labels that hide only at narrow widths. Collapse still does
  not move selection.
- [x] 5. **Bracket guides and selection hierarchy**: pure `guidesFor(displayRows, rows)` walks the
  displayed rows with an open-container stack; every rendered node/brace row gets one absolute
  `.guide` span per open container. Guides are `opacity: .28` at rest and `guide-active` at `.85` on
  container hover. Pure `subtreeRowIds(selectedId, rows)` marks visible descendants with
  `data-subtree`; a selected parameter adds the stronger fill, 2px rail and 1px outline. Deleted the
  repeating-gradient background and the selected-branch `data-branch` path.
- [x] 6. **Details editor module**: renamed `ecucValueEditor.ts` to `ecucDetailsEditor.ts` and
  `detailsEditorScript()`; removed inline `valueEdit`/`beginValueEdit`/`detachValueEdit`/
  `reattachValueEdit`; added `detailsValueInput(row, data)`, `beginDetailsEdit(rowId)`,
  `commitDetailsEdit`, `cancelDetailsEdit`, Tab move, error/invalid handling, flash and message
  handling. The existing `{type:'edit', nodeId, value}` write path is unchanged.
- [x] 7. **Details panel UI**: `InspectorFields` lost `source`; `updateInspector` renders the value
  input for parameters and removes the Source row and Copy path/Copy value/Copy target buttons;
  actions contain only Reveal in source. Removed the provider copy branch/`text` message and deleted
  `clipboard.ts`/`copy.test.ts`.
- [x] 8. **Interactions**:
  - `onRowClick`: parameter `.value-text` selects + opens details edit; `=`/label selects only;
    followable reference value/target follows; an unresolved target falls through to select; twisty
    toggles.
  - `onTreeKeydown`: `F2`/`Enter` on a parameter opens details edit; container Enter toggles;
    followable reference Enter follows; Ctrl/Alt+Enter reveals; Space/arrow/Home/End/PageUp/PageDown/
    type-ahead unchanged.
  - Removed the F2 pseudo hint and the inline `.value` cursor/dotted-underline edit affordance.
  - Details input: Enter commit, Escape reset, Tab/Shift+Tab commit+move; refusal keeps text/error.
- [x] 9. **Follow and accents**: `buildRows` marks `followable` only when
  `resolvePath(pathIndex, target)` succeeds; the provider's `follow` selects the target node in the
  ECUC editor. Container labels use the namespace green; reference targets use the function yellow
  and italic. Dark is the only supported theme; high contrast remains.
- [x] 10. **Re-scan/state**: `RowState` loses `view`; `uiState` holds only `inspectorHidden`; provider
  pushes `{type:'model', rows, selectedId}`; selection/subtree/guide hover/details visibility/scroll
  survive; details input updates after a successful re-scan; no copy/digits message fields.
- [x] 11. **Preview/bench/docs**: removed `?view=tree` from `preview-ecuc.js` and its panel; updated
  `preview:check` for the Document shell (no view toggle, spacers/window, inspector, no digits);
  updated `docs/ECUC_EDITOR.md`, `.trellis/spec/frontend/*` and
  `docs/ECUC_EDITOR_DESIGN_SPEC.md` for the Document-only, bracket-guide, dark, same-file-follow,
  details-editing, no-copy/source design; removed Tree/line-number/F2/copy references.
- [x] 12. **Tests**: updated/renamed `uxTree.test.ts` to Document interactions; updated
  `uxDocument`, `uxPolish`, `uxColors`, `uxFilter`, `a11y`, `editing`, `render`, `renderRows`,
  `rescan`, `virtualPage`; added details-editor, bracket-guide, subtree, follow and colour tests;
  deleted the copy tests/clipboard. Every new assertion fails when its feature is removed.
- [x] 13. **Visual QA**: captured dark/HC, selected parameter, selected container subtree, guide
  hover, details open, value-edit focused, filtered/empty, narrow and deep/large/huge; verified no
  line numbers, no continuous guides, aligned braces/header, no F2 hint, details input focus/error
  and Reveal-only actions.
- [x] 14. **Performance**: reran the CDP harness for large/huge; recorded load, filter, rendered
  treeitems and payload; reran node-side `perf:ecuc`.
- [x] 15. **Mutation checks** (table below), restoring source after each.
- [x] 16. **Final gates**: `npm run check-types`, `npm run lint`, `npm test`, `npm run preview:check`;
  stopped the preview server; removed generated capture `.html` files; recorded the results.
- [ ] 17. **Review**: run `@code-review` against this task's PRD/design/implement and the design
  spec; fix findings; commit and archive.

## Test coverage

| Area | Tests |
|---|---|
| Row model | ordering/meta/value/target/context/haystack; no digits/source fields; huge generation |
| Document shell | no view toggle/Tree CSS/glyphs/chips; no line numbers/data-line/digits; one probe; braces/header/fold geometry |
| Bracket guides | `guidesFor` open/close/nesting/header cases; `.guide` spans with level/container id; hover activation; no global gradient |
| Selection hierarchy | `subtreeRowIds` root/leaf/missing selection; `data-subtree` only on visible descendants; parameter outline; no syntax recolour |
| Document read-only | `.value` direct child, no inline input, value/`=`/label click behavior, value title |
| Details editor | input creation/aria, click/F2/Enter entry, Enter/Escape/Tab, refusal/error, success re-scan/flash |
| Details cleanup | no Source row, no copy actions/message/clipboard module; Reveal remains |
| Follow/accents | same-file `followable` only; provider selects target container; green container/yellow italic reference CSS |
| Interactions | selection/focus/collapse/filter/scroll/reveal/re-scan; offscreen details; labelled collapse controls |
| A11y | flat tree roles/levels/positions/sizes/expansion/selection; details input label/invalid/error; focus restore |
| Visuals | dark/HC, selected parameter, container subtree, guide hover, details states, filtered/empty, narrow, deep/large/huge |
| Performance | large/huge load/filter/DOM/payload; no blank gaps |
| Gates | type/lint/test/preview:check + mutations |

## Mutation checks

Final run: **21/21 caught**.

| Mutation | Expected failing test |
|---|---|
| Re-add the Tree toggle/view state | Document-only shell test |
| Re-add a source-line row attribute | rows carry no display-only test |
| Re-add the repeating global indent guide | document CSS is one editor surface test |
| Drop the bracket-guide computation | subtree ids and bracket guides test |
| Leak bracket guides to every row | subtree ids and bracket guides test |
| Re-add the inline value editor style | quiet selection test |
| Re-add the F2 pseudo hint | a toggle is built only test |
| Re-add the details Source row | inspector reads row data test |
| Re-add a Copy path action | inspector reads row data test |
| Drop the details edit post | details editor owns test |
| Re-add digits to the re-scan message | re-scan preserves selection test |
| Re-add the Tree glyph CSS | Tree kind glyphs test |
| Switch the container accent back to class orange | document labels and reference values test |
| Make every reference followable | reference followability is same-file only test |
| Leak the selected subtree to every row | subtree ids and bracket guides test |
| Remove the collapse/expand labels | strip keeps the collapse/expand test |
| Remove the twisty stretch | strip keeps the collapse/expand test |
| Re-add the 9ch scroll padding | details width and narrow layout test |
| Re-add the high-contrast subtree fill | details width and narrow layout test |
| Drop brace hover for the guide | bracket guides fade at rest test |
| Discard a pending details draft on rebuild | refused/pending draft test |

## Performance commands

```bash
npm run preview:ecuc
# ?fixture=sample/large&theme=dark&chrome=0
# ?fixture=sample/huge&theme=dark&chrome=0
npm run perf:ecuc -- D:\workspace\sample\large.arxml
npm run perf:ecuc -- D:\workspace\sample\huge.arxml
```

Measure `performance.getEntriesByType('navigation')`, filter pass, rendered treeitems,
`document.querySelectorAll('#tree [role="treeitem"]').length`, payload bytes and a memory
observation. The harness is not a VS Code webview.

## Review gate

Before commit, run `@code-review` with the task PRD/design/implement, `docs/ECUC_EDITOR.md`, the
frontend specs and `docs/ECUC_EDITOR_DESIGN_SPEC.md`. Record findings and fixes. Keep `src/core/**`,
the provider write path, manifest and dependencies untouched.

## Done when

- [x] AC1-AC13 in `prd.md` pass.
- [x] Tree view, line numbers, global guides, inline editing, F2 hint, Source and copy actions are
  gone; bracket guides, selection hierarchy, same-file follow and details editing work.
- [x] Visual captures and large/huge performance are recorded.
- [x] Full gates green; mutation checks fail their intended tests.
- [x] Docs/specs are updated; `src/core/**`, manifest and dependencies untouched.
- [x] Preview server stopped; generated capture `.html` files removed.
- [ ] Task committed and archived.

## Implementation record (2026-10-28)

Status: implementation and verification complete; code review fixes applied; commit/archive pending.

### Delivered

- `src/editor/renderRows.ts`: removed `digits` and all source-position fields; rows remain the
  display/meta/value/target/context/haystack model. Reference rows carry `followable` only when
  `resolvePath` succeeds.
- `src/editor/renderHtml.ts`: Document-only shell and flex geometry, no line-number gutter/global
  guides, bracket-guide spans with hover activation, `data-subtree` selection tint, stronger
  selected-parameter row, labelled larger Collapse/Expand controls, visible twisty, green container
  names, yellow-italic reference targets, read-only values, details input, re-scan without digits,
  and preview-compatible static `data-view="document"`.
- `src/editor/ecucDetailsEditor.ts` (renamed from `ecucValueEditor.ts`): details-panel value input,
  click/F2/Enter entry, Enter commit, Escape restore, Tab/Shift+Tab move, refusal error/focus and
  row flash. The Document has no inline editor.
- `src/editor/ecucEditorProvider.ts`: no copy branch/`text` message, no `LineIndex`, same-file
  `follow` selects the target node in the editor, re-scan posts `{ type:'model', rows, selectedId }`.
- `src/editor/clipboard.ts` and `src/test/editor/copy.test.ts` deleted.
- `scripts/preview-ecuc.js`/`scripts/bench-ecuc.js`: no `?view`, digits or line-index assumptions;
  preview check asserts the Document shell and absence of view toggle/line-number payload; the
  theme list is dark/HC only.
- Docs/specs: `docs/ECUC_EDITOR.md`, `docs/ECUC_EDITOR_DESIGN_SPEC.md` and frontend
  component/directory/quality/state/testing specs updated for Document-only/details editing.

### Bugs found and fixed during browser QA

- Module/container labels overlapped their inline metadata because the old `.row.no-value .label`
  flex-shrink rule survived the Tree removal; it was removed so the label keeps its full width.
- Braces sat one fold-column left of their labels; brace rows now add the 3ch fold width to their
  level padding.
- The earlier selected-branch CSS targeted `.row[data-branch]` while the marker was on `.node`; the
  selector was corrected, then the whole branch-guide mechanism was replaced by bracket guides.
- Guide spans were checked at each nesting level: a row inside two containers carries two segments,
  the opening brace carries only outer guides, and the closing brace ends the inner guide.
- The subtree tint initially risked leaking to siblings; `subtreeRowIds` now slices by
  `subtreeSize` and the page only marks rows whose ids are in that set (covered by mutation 15).
- The twisty span covered only its 12px icon, so the row above/below the icon selected instead of
  toggling; `align-self: stretch` gives it the full row-height hit area.
- High contrast still painted the subtree fill; the HC/forced-colors rules now use a transparent
  background and a dotted outline.
- Hovering a brace row cleared the guide because `onTreeHover` only matched `role="treeitem"`; a
  brace now keeps its container's guide active.
- A pending details write could be replaced by an inspector rebuild, dropping the typed text before
  the warn notice arrived; the same-row draft and its pending flag now survive the rebuild.
- The horizontal `scroll-padding-left` still used the removed gutter's `9ch`; it now follows
  `--doc-pad`.

### Review record

- Two-axis review (Standards and Spec) against `git diff HEAD`; fixes applied:
  - high-contrast/forced-colors subtree rows now use a dotted outline instead of the fill;
  - the twisty span stretches to the full row height, restoring the hit area;
  - hovering a brace keeps its container's guide active;
  - a pending details draft survives an inspector rebuild, so a refusal can still mark the kept
    text;
  - `scroll-padding-left` follows `--doc-pad`, not the removed `9ch` gutter constant;
  - stale comments/docs (view/branch/source/copy wording) were corrected.
- Contrast measured in the harness: `#4EC9B0` 8.18:1, `#DCDCAA` 11.8:1, key accent `#75BEFF`
  8.39:1 on `#1e1e1e`.
- Remaining review note: details editing is exercised through the page's serialized source plus the
  browser harness; a full DOM/Extension Development Host automation is still manual.

### Verification

- `npm run check-types`: pass.
- `npm run lint`: pass.
- `npm test`: **208 passing**.
- `npm run preview:check`: pass.
- Mutation table: **21/21 caught** (list above).
- Browser contrast on the dark editor background `#1e1e1e`: container `#4EC9B0` **8.18:1**,
  reference target `#DCDCAA` **11.8:1**, parameter key `#75BEFF` **8.39:1**.

### Browser harness (headless Edge via CDP, dark, this machine)

| Sample | DOMContentLoaded | load | treeitems | filter scan | payload | heap |
|---|---|---|---|---|---|---|
| `sample/large` | 124–138 ms | 127–139 ms | 32 | 1.4–2.1 ms | 1.89 MB | 5.3–5.8 MB |
| `sample/huge` | 210–284 ms | 212–288 ms | 33 | 4.3–6.8 ms | 5.67 MB | 13.4–14.7 MB |

Scroll sweep 0/25/50/75/100%: 32–44 treeitems (36–50 nodes including braces), maximum inter-row
gap `0`, top + window + bottom height equal to the virtual total. Node-side `perf:ecuc`: large
buildRows 14.1 ms / renderHtml 18.1 ms; huge 39.6 ms / 54.6 ms; huge row JSON 5.40 MiB. Timings vary
between runs; the ranges above are repeated harness runs, not a promise.

### Visual evidence

`research/visual/` PNGs: dark, HC, selected parameter, selected container (subtree), guide hover,
details open, value-edit focused, filtered, filter-empty, narrow, deep, large, huge. Light and
branch-guide captures were removed. Generated `.html` captures are removed before commit.

### AC verdicts

- **AC1 pass**: no Tree toggle/state/CSS/glyph; Document collapse/filter/selection/reveal/re-scan
  still tested.
- **AC2 pass**: no line-number gutter, `data-line`, `digits` or display-only source fields; header,
  text, braces and fold column align in dark/HC/narrow/deep captures.
- **AC3 pass**: `guidesFor` draws one segment per open container from opening to closing brace;
  rest/hover opacity and collapse/filter/scroll recomputation are tested and captured.
- **AC4 pass**: Document value/`=`/label read-only; `.value` direct child; value-click opens details.
- **AC5 pass**: details click/F2/Enter, commit/Escape/Tab, refusal text/error and success re-scan/flash
  are implemented and tested; harness observed a focused input and a posted edit.
- **AC6 pass**: no F2 pseudo hint, no Source block, no Copy path/value/target or host copy message;
  Reveal remains.
- **AC7 pass**: quiet-source tokens, braces, metadata, selection rail, details and empty states are
  preserved; dark/HC captures recorded.
- **AC8 pass**: gates + 208 tests + 21/21 mutations; load/filter/DOM/payload recorded.
- **AC9 pass**: docs/specs updated; `src/core/**`, write path, manifest and dependencies untouched.
- **AC10 pass**: Collapse/Expand are labelled and larger; the row twisty is visible at rest;
  selection is preserved.
- **AC11 pass**: green containers, yellow-italic reference targets, dark only with HC retained; no
  light-theme styling remains.
- **AC12 pass**: `followable` is same-file only; provider test follows to the target container;
  unresolved targets are not links.
- **AC13 pass**: container/module selection tints the visible subtree; parameter selection adds the
  stronger fill/rail/outline; syntax colours are unchanged.

### Remaining gaps

- The browser harness is not a real VS Code webview; theme/font/focus resolution was not rechecked in
  an Extension Development Host.
- The accessibility tree still exposes only the rendered virtual window.
- Details input/refusal and Tab move were source/structurally tested and browser-observed for
  focus/commit; the full Extension Development Host path remains manual.
- The filter keeps its deliberate 120 ms debounce.
- Harness timings vary; the recorded ranges are evidence, not a performance promise.
