# Journal - deviousprophet (Part 1)

> AI development session journal
> Started: 2026-10-27

---



## Session 1: ECUC visual preview, samples and semantic colours
<!-- trellis-session: v=2 fp=96ad8671fa56090c -->

**Date**: 2026-10-27
**Task**: ECUC visual preview, samples and semantic colours
**Branch**: `feat/arxml-scope`

### Summary

Browser preview harness, details inspector, semantic element colours, synthetic 4k/12k samples and benchmark, plus the code-review fixes.

### Main Changes

- Preview harness and details inspector
- Semantic colours and selected-row contrast
- Synthetic large samples and renderer benchmark
- Code-review fixes and test isolation

### Git Commits

| Hash | Message |
|------|---------|
| `1dc1cd9` | feat(editor): add a visual preview harness and details inspector |
| `d8f25fa` | feat(editor): colour ECUC elements by their ARTEXT scope |
| `f3fcc26` | feat(dev): generate ECUC samples and benchmark the renderer |
| `84f4aa7` | fix(editor): keep value kinds and selected markers legible |
| `66e0a41` | fix(dev): guard sample output and share the out loader |
| `2bce121` | docs(spec): clarify the inspector data contract |

### Testing

- [OK] 151 passing; preview:check ok
- [OK] 4,001/12,001-node benchmark and browser load observations

### Status

[OK] **Completed**

## Session 2: ECUC document-style viewer redesign

**Date**: 2026-10-27
**Task**: ECUC viewer document-style redesign (archived)
**Branch**: `feat/arxml-scope`

### Summary

Replaced the chip-heavy default tree presentation with a dense, monospace Document view modelled on the post-processed ARTEXT reference, keeping the previous Tree view behind a toolbar toggle and hiding the details inspector by default.

### Main Changes

- Captured the reference by running the remote branch's `Arxml2Artext.cmd` (`mmx`) and applying `postProcessArtextGen`; stored the post-processed `.artext`, scoped HTML mock and README in the task research.
- Document view default: one entity per line, editor monospace, 4-space indentation, braces, inline metadata, no chips/fixed columns/per-row borders.
- Semantic token colours mapped from the reference TextMate scopes to `--vscode-*` variables; module prefix and selected/focused label emphasis.
- View and Details toggles, both persisted through `getState()/setState()`; details hidden on first paint.
- Preview harness `?view=document|tree` seeding, document tests, docs and frontend spec updates.

### Git Commits

| Hash | Message |
|------|---------|
| `2d328df` | feat(editor): make the ECUC document view the default presentation |
| `e95c62f` | chore(task): archive 10-27-ecuc-viewer-document-redesign |

### Testing

- [OK] `npm run check-types`, `npm run lint`
- [OK] 157 passing; `preview:check` ok
- [OK] Document mode: large 609/688 ms load, 54.1 ms filter; huge 1,605/1,833 ms load, 134.1 ms filter
- [OK] Six mutations (default view, row layout, view toggle, inspector default, module prefix, selection emphasis) each failed a test

### Status

[OK] **Completed**

## Session 3: ECUC document view editor-like visual pass

**Date**: 2026-10-27
**Task**: ECUC document view editor-like visual pass (archived)
**Branch**: `feat/arxml-scope`

### Summary

Reworked the Document view from a tree skin into a calm editor-like text surface: neutral labels, a restrained semantic palette, no underlined targets or dotted values, a gutter twisty, exact 4ch indentation, a compact bar and a quiet line selection. Tree view is unchanged.

### Main Changes

- Document labels use the editor foreground; only keywords, strings, numbers/hex, booleans and annotations keep accent.
- Reference targets are plain until hover; parameter values lose the dotted underline and hover pencil.
- The twisty moves into a 3.5ch gutter; children indent 4ch and braces align with the parent row.
- Selection is an editor line highlight plus a 2px focus edge, not the list-selection bar.
- Document bar is compact (3px padding, 240px filter, flat buttons); Tree view keeps the base bar.
- Corrected the prototype after it still showed the old `.value` dotted underline; the final production CSS removes it.
- Document tests extended for the neutral palette, gutter, selection, value affordance and bar; docs and frontend specs updated.

### Git Commits

| Hash | Message |
|------|---------|
| `d074185` | feat(editor): make the ECUC document view read like an editor |
| `d0424f1` | chore(task): archive 10-27-ecuc-document-editor-look |

### Testing

- [OK] `npm run check-types`, `npm run lint`
- [OK] 160 passing; `preview:check` ok
- [OK] 7 mutations (label colours, target underline, dotted value, twisty flow, selection bar, toolbar padding, header keyword) each failed a test
- [OK] Document large 798/901 ms load, 56.3 ms filter; huge 2,200/2,512 ms, 119.6 ms filter

### Status

[OK] **Completed**

## Session 4: ECUC quiet-source design implementation

**Date**: 2026-10-28
**Task**: ECUC editor quiet-source (archived)
**Branch**: `feat/arxml-scope`

### Summary

Implemented the quiet-source design spec on the ECUC Document view: real source line numbers and gutter, 26px strip, token system, full-row selection rail/tint, muted value separator, inline invalid reason, details/bottom sheet, and Tree surface alignment. Then ran @code-review and fixed the findings.

### Main Changes

- `data-line`/`#tree data-ln-digits`, CSS `:has` gutter width (no CSP-blocked style attribute).
- `--tok-*` palette with `@supports` color-mix fallbacks; 10% dark/no-fill light selection for contrast.
- Source line-number gutter, fold chevrons/collapsed stub, muted `=` punctuation, F2 hint.
- Real 26px strip, filter/count/icons/Document|Tree/Details switch, notice under the strip.
- Details panel clamp/stacked keys/actions/empty copy/bottom sheet.
- Inline invalid reason and 1s flash; high-contrast outlines in both views.
- Tree view shared surface/tokens/states; chips, glyphs, dotted values retained.
- Docs/specs and tests updated; 14 stale generated capture HTML files removed.

### Git Commits

| Hash | Message |
|------|---------|
| `0eb70ca` | feat(editor): implement the quiet-source ECUC document view |
| `8d8c1be` | chore(task): remove generated capture HTML |
| `fef027b` | fix(editor): address quiet-source review findings |
| `d393230` | chore(task): archive 10-27-ecuc-editor-quiet-source |

### Testing

- [OK] `npm run check-types`, `npm run lint`
- [OK] 166 passing; `preview:check` ok
- [OK] 10 mutations each failed their intended test
- [OK] `@code-review` findings fixed; spec file unchanged
- [OK] Document captures in light/dark/HC, selected, collapsed, invalid, details, narrow; Tree captures

### Known Follow-ups

- Huge sample load ~3.8 s vs ~2.2 s from 12k line-number pseudo-elements; no virtualisation.
- Real source line numbers are non-monotonic under the legacy `all` sort; `declaration` is ascending.
- Narrow capture is at the harness 492px floor; real 360px webview check remains.
- Light selection uses the 2px rail (no fill) to keep the key accent at 4.51:1.

### Status

[OK] **Completed**

## Session 5: Virtualized ECUC rendering and indexed filtering

### Summary

Replaced the full ECUC tree DOM (12,001 rows on `sample/huge`) with a host row document plus a
flat, windowed viewport renderer, and replaced the DOM-scanning filter with a row-indexed,
debounced/cancellable engine. Document/Tree visuals, selection/focus/collapse/inspector/editing/
reveal/follow/copy/re-scan and the `.value` direct-child contract are preserved.

### Main Changes

- `src/editor/renderRows.ts`: compact `EcucRow`/`RowDocument` data (display order, parent/subtree,
  level/posinset/setsize, meta/value/target/context, source, haystack, digits).
- `src/editor/virtualScroll.ts`: pure cumulative-height range/offset/total math, serialized into
  the page; fixed Document heights and two Tree heights.
- `src/editor/filter.ts`: `buildFilterIndex`/`filterRows` (matches + ancestors), `flattenRows`
  (collapse/filter/braces), generation-guarded debouncer; no DOM scan.
- `src/editor/renderHtml.ts`: static virtual shell, escaped row JSON, viewport window + spacers,
  rAF scroll, flat ARIA tree, row-data inspector, keyboard/type-ahead/reveal/follow/copy/editing,
  re-scan and view toggle.
- Provider re-scan now posts rows; `ecucValueEditor` uses the page's flat row order and reattaches
  an open edit across a window rebuild.
- Docs/frontend specs updated; `docs/ECUC_EDITOR_DESIGN_SPEC.md`, `src/core/**`, manifest and
  dependencies untouched. No worker/new dependency/CSP change.

### Git Commits

| Hash | Message |
|------|---------|
| `a7b93c4` | feat(editor): virtualize ECUC rows and index filtering |
| `bcc1fd5` | chore(task): archive 10-28-ecuc-virtualized-render-search |

### Testing

- [OK] `npm run check-types`, `npm run lint`
- [OK] 212 passing; `preview:check` ok
- [OK] 12/12 mutation checks caught
- [OK] `@code-review` findings fixed (filtered `aria-expanded`, detached value edit, host-select
  spacer refresh, duplicate roving, preview shell assertions, spec drift)
- [OK] Document/Tree captures: light/dark/HC, selected/focused, filtered, empty, details, narrow,
  large, huge, deep

### Performance (headless Edge via CDP, dark)

| Sample | View | load | filter scan | treeitems |
|---|---|---|---|---|
| `sample/large` | Document | 155 ms | 2.2 ms | 32 |
| `sample/huge` | Document | 256 ms | 8.6 ms | 33 |
| `sample/large` | Tree | 129 ms | 1.8 ms | 27 |
| `sample/huge` | Tree | 259 ms | 5.6 ms | 27 |

Baseline was ~823 ms / ~3,855 ms load and ~56 ms / ~102 ms filter with the full 12k-row DOM. Scroll
sweep 0–100% had maximum inter-row gap 0 and spacers summing to the virtual total.

### Known Follow-ups

- Real VS Code webview check (theme/font/focus/clipboard) remains manual.
- The accessibility tree exposes the rendered window; offscreen rows must be scrolled in.
- Filter input has a deliberate 120 ms debounce; scan numbers above are engine time.
- Initial row JSON grows linearly (~6.5 MiB for `sample/huge`).

### Status

[OK] **Completed**


## Session 6: ECUC Document-only UI polish
<!-- trellis-session: v=2 fp=929b2d8910bbe127 -->

**Date**: 2026-10-28
**Task**: ECUC Document-only UI polish
**Branch**: `feat/arxml-scope`

### Summary

Finished the Document-only ECUC editor: no Tree view or line numbers, bracket guides, details-panel editing, same-file follow, subtree/active selection, labelled collapse controls and dark semantic accents.

### Main Changes

- Document-only renderer and CSS: bracket guides, green containers, yellow-italic reference targets, larger labelled Collapse/Expand and a full-row-height twisty.
- Details-panel value editor with Enter/Escape/Tab, refusal/error and pending-draft preservation; removed the F2 hint, Source block, copy actions and clipboard path.
- Same-file follow selects the target container; selection tints containers/subtrees and strengthens the selected parameter; docs/specs and task artifacts updated.

### Git Commits

| Hash | Message |
|------|---------|
| `1e84dc0` | feat(editor): finish the Document-only ECUC surface |
| `09cbf7e` | chore(task): archive 10-28-ecuc-document-ui-polish |

### Testing

- [OK] npm run check-types, npm run lint, npm test (208 passing), npm run preview:check
- [OK] Mutation table 21/21 caught; dark/HC harness captures and contrast measurements recorded

### Status

[OK] **Completed**

### Next Steps

- Manual Extension Development Host check for real webview theme/focus and details input; no follow-up task opened


## Session 7: ECUC container selection and green accent fix
<!-- trellis-session: v=2 fp=8159c14bcf65da4f -->

**Date**: 2026-10-28
**Task**: ECUC container selection and green accent fix
**Branch**: `feat/arxml-scope`

### Summary

Fixed the selected-container hierarchy and the container-name colour reported after the Document UI pass.

### Main Changes

- Selected containers/modules now use the strong active fill, 2px rail and thin outline; the subtree tint is softer so the selected row reads first.
- Container names use the fixed dark green #4EC9B0 instead of the theme symbol-icon variable, which some themes resolve to white; HC/forced colors use the editor foreground.
- Updated docs/specs, tests and the container-selected capture.

### Git Commits

| Hash | Message |
|------|---------|
| `ba668f3` | fix(editor): make container selection unmistakable |

### Testing

- [OK] npm run check-types, npm run lint, npm test (208 passing), npm run preview:check

### Status

[OK] **Completed**

### Next Steps

- Manual Extension Development Host check remains for real webview theme/focus and details input
