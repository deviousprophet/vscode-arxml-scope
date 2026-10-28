# ECUC virtualized rendering and search/filter engine

## Goal

Remove the large-file lag in the ECUC custom editor. Today the Document and Tree views build the
entire row DOM (12,001 rows for `sample/huge`, plus a line-number pseudo-element per row) and the
filter walks/toggles that whole DOM. The page takes ~3.8 s to load on `sample/huge` and the filter
pass is ~100 ms; scrolling and filtering feel heavy. Replace the full render with a **flattened
visible-row model and a windowed virtual renderer**, and add an **indexed, debounced filter engine**
over those rows. Rendering, filtering and highlighting should scale with the viewport, not the file.

The reference repo `D:\workspace\vscode-hex-scope` was inspected read-only for patterns: its pure
`src/webview/render/virtualScroll.ts` math (cumulative heights, visible range, overscan, spacers), its
windowed `memoryGrid.ts`, and its debounced/cancellable search engine. It is a flat grid, so it is an
idea reference only; the ECUC tree, two views and editing contracts are our own.

## Scope

**In**

- A host-generated **row data model** for every ECUC entity (id, kind, level, parent, subtree size,
  display fields, meta fields, source position, search haystack, value/target data). No full-tree HTML
  string in the page.
- A **flattened visible-row list** derived from the row data, collapse state and filter results,
  including Document brace rows.
- A **virtual scroll window** over `#main`: only viewport rows plus overscan in the DOM, top/bottom
  spacers, row-range math, scroll handling, and both Document and Tree row heights.
- An **indexed filter/search engine**: normalized haystacks, debounced query, generation/cancel,
  matches plus ancestors, count/empty state, and highlighting only rendered rows.
- Rewiring selection, focus, keyboard navigation, collapse/expand, filter, scroll persistence,
  view toggle, details inspector, inline editing, reveal/follow, copy and re-scan to the row model /
  visible list.
- Flat-tree accessibility: `role=tree`, `role=treeitem`, `aria-level`, `aria-expanded`,
  `aria-selected`, `aria-posinset`/`aria-setsize`, roving tabindex, and a rendered focused row.
- Tests, browser captures, benchmarks, docs and frontend specs; mutation checks.

**Out**

- Changes to `src/core/**`, the parser/model/ordering/validation, the write path, the manifest or
  `package.json` dependencies.
- A Web Worker, service worker, remote asset, new dependency, or a CSP relaxation beyond the existing
  nonce-based inline scripts/styles.
- Virtualizing across files, workspace search, semantic type search, or an inverted full-text index.
- A new visual design; the quiet-source and Tree presentations stay, including the line-number gutter,
  braces, tokens, details panel and bottom sheet.
- Structural editing, retargeting references, soft wrap, or cross-file reference resolution.
- A real VS Code webview claim; the browser harness remains page-side evidence.

## Requirements

- **R1 - Row data, not row HTML.** The host builds a compact row model from the existing model using
  the same ordering/meta rules. The page receives it as escaped JSON (initial) and as row data on a
  re-scan. The page must not require a full `renderTree` HTML string for a 12k file.
- **R2 - Flattened tree.** Rows are in display order with `parentId`, `subtreeSize`, `level`,
  `posinset`, `setsize`, `hasChildren`. Collapse hides a contiguous subtree; filter keeps matching
  nodes plus their ancestors; Document adds open/close brace rows. Tree has no braces.
- **R3 - Windowed render.** Only a viewport-sized range plus overscan is in the DOM (target <= 200
  treeitems). Top/bottom spacers preserve the full scroll height. The window updates on scroll,
  collapse, filter, view change and data replacement without rebuilding the whole tree.
- **R4 - Row heights.** Document node/brace rows use the document line height; Tree rows use a fixed
  two-line height with a one-line metadata area (or a deterministic two-height variant). The virtual
  math and CSS heights must agree; no blank gaps or overlapping rows at the window edges.
- **R5 - Filter engine.** Precompute a normalized haystack per row (label, short name, value);
  debounce the input, cancel stale queries with a generation token, find matches, include ancestors,
  and update the visible list/count/empty state. Highlight only rows in the rendered window. Keep the
  existing substring semantics and the existing label/short-name/value match fields.
- **R6 - State and interactions.** Selection, focus, collapsed set, filter query, scroll position,
  view mode and details visibility survive a re-scan where possible. Click select, twisty toggle,
  double-click/Ctrl+Alt+Enter reveal, target follow, Space/Enter, Home/End, PageUp/PageDown,
  type-ahead, F2/value edit, Tab/Shift+Tab, copy and Escape keep working.
- **R7 - Inspector and editing.** The details inspector reads the selected row from the row data, not
  from a rendered row, so an offscreen selection still shows correct details. `.value` stays a direct
  child of `.row`; the value widget stays the first document listener with
  `stopImmediatePropagation`; editing still starts from `data-value`.
- **R8 - Accessibility.** The flat tree exposes real tree semantics, levels, positions, sizes,
  expansion and selection; the focused/selected row is always rendered and focusable. Focus is
  restored after a window update when the previous focus row remains visible. The hidden spacer rows
  are `aria-hidden`/presentation. The screen-reader window limitation is documented.
- **R9 - Performance.** Target on the browser harness: `sample/large` load <= 600 ms and
  `sample/huge` load <= 1.5 s (from ~0.8 s / ~3.8 s); filter <= 30 ms (from ~55 ms / ~100 ms); no
  full-tree DOM; scroll window updates do not render more than the target row count; no blank gaps
  during normal scrolling. Record measured numbers; do not claim a real VS Code webview result.
- **R10 - Contracts.** One DOM/two views, no second renderer; no `.artext`/`mmx`; no new dependency/
  asset/worker; CSP nonce; no `innerHTML` from model text (build rows with text nodes); `src/core/**`,
  write path and manifest unchanged; `docs/ECUC_EDITOR_DESIGN_SPEC.md` is not edited.
- **R11 - Verification.** Pure virtual-scroll/flatten/filter unit tests; browser captures for
  Document/Tree, selected/focused, filtered/empty, deep/huge; mutation checks; full gates; docs and
  frontend specs.

## Acceptance Criteria

- [x] **AC1** The host generates row data with every display/meta/source/search field needed by the
      current UI; the page receives initial row JSON and re-scan row data without full-tree HTML.
- [x] **AC2** A flattened visible list drives both views: collapse, filter and Document brace rows are
      correct; `parentId`/`subtreeSize`/level/posinset/setsize are consistent.
- [x] **AC3** The virtual window renders only viewport + overscan (target <=200 treeitems), with
      correct top/bottom spacers and total height; scrolling has no blank gaps or overlaps in the
      large/huge samples.
- [x] **AC4** Filtering is debounced/cancellable, uses the normalized row index, includes matches and
      ancestors, keeps the existing match field semantics, reports the count/empty comment, and
      highlights only visible rows.
- [x] **AC5** Selection, focus, collapse, filter, scroll, view toggle, details, reveal/follow, copy,
      inline editing and re-scan work from the row model; `.value` remains a direct child and the
      value-widget listener order is unchanged.
- [x] **AC6** The flat tree keeps accessible levels/positions/sizes/expansion/selection; the focused
      row is rendered; focus survives a window update; spacer rows are hidden from the tree.
- [x] **AC7** Document and Tree keep the quiet-source/Tree presentation (line numbers/braces, tokens,
      chips/glyphs/dotted Tree values) with no material visual regression; captures show both.
- [x] **AC8** Performance targets are measured and recorded: large/huge load, filter, row count,
      scroll window, memory; the old full-DOM path is gone; no virtualisation of the wrong layer.
- [x] **AC9** `npm run check-types`, `npm run lint`, `npm test`, `npm run preview:check` are green;
      pure math/flatten/filter tests and mutation checks pass.
- [x] **AC10** `docs/ECUC_EDITOR.md` and the frontend specs document the row model, virtual window,
      filter engine, a11y window and limits; `src/core/**`, dependencies, manifest and write path are
      untouched; the read-only design spec is unchanged.

Evidence: see `implement.md` → *Implementation record* for the delivered files, gates, mutation
results, harness measurements, captures and AC-by-AC verdict.

## Constraints

- No new dependency, asset, font, remote load, Worker or service worker. The page uses the existing
  nonce CSP and inline script/style model.
- No full-tree `innerHTML`; row text is inserted with DOM APIs (`textContent`/text nodes), attributes
  escaped. Initial row JSON is escaped for the script context.
- Row heights must be deterministic and match the virtual math; no runtime measurement that depends
  on the window.
- Keep the existing filter semantics (substring over label, short name and value) and the current
  counting/empty-state language.
- The flat tree drops `role=group` wrappers; this is a deliberate a11y representation change. The
  level/posinset/setsize attributes and rendered focus row are the compensating contract; the
  screen-reader window limitation is recorded, not hidden.
- The performance targets are harness observations on this machine; a real VS Code webview remains a
  manual Extension Development Host check.
