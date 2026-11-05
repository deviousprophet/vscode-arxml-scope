# Implement — schema/package content rows and one shared VirtualScroll

## Preconditions

- Phase 1 decisions D1–D12 are settled in `design.md`.
- `task.py start` only after this plan and the PRD are reviewed.
- Branch: create/switch to a feature branch from `main` unless the user names one.

## 1. VirtualScroll component

Create `src/webview/components/virtualScroll/virtualScroll.ts` and its CSS.

Contract:

```ts
interface VirtualScrollContent {
	rowCount: number;
	offsets: readonly number[];   // length rowCount + 1, cumulative pixels
	totalHeight: number;          // offsets[rowCount]
	contentWidth: number;         // shared horizontal extent
}

class VirtualScroll {
	mount(root: Element): void;
	setContent(content: VirtualScrollContent): void;
	getViewport(): { top: number; left: number; height: number; width: number };
	getVisibleRange(): [number, number];
	setScrollTop(top: number): void;
	setScrollLeft(left: number): void;
	scrollToIndex(index: number, align?: 'auto' | 'start' | 'end'): void;
	onScroll(callback: (viewport: Viewport) => void): void;
}
```

- Owns the vertical native scroller, the horizontal scrollbar (native proxy or equivalent), the content height and the shared horizontal offset.
- Vertical content height comes from `totalHeight`; the thumb and drag are exact.
- Horizontal bar spans the whole surface. In the diff, the pane split stays fixed and each pane’s content layer is translated by the shared horizontal offset.
- No per-scroll height calculation: binary-search `offsets` for the visible range.
- Emit one coalesced scroll/render callback per animation frame.
- Keep the existing `render/virtualScroll.ts` math as the pure helper; do not duplicate it.

## 2. DocumentTreeView becomes a window renderer

Refactor `src/webview/components/documentTree/documentTreeView.ts`:

- Remove the owned scroller, title bar, pinned meta, top/bottom spacers and scroll listeners.
- Keep a content layer that receives the shared offsets and viewport, renders `[start, end)`, and positions the window at `offsets[start]`.
- Keep row click/focus handling and row markup; header rows are just another row kind.
- Expose the rendered window and the focused-row lookup for search/reveal.
- Remove `setHeader`, `headerHeight`, `getRowsScrollTop`/`setRowsScrollTop` or replace them with VirtualScroll calls.
- Preserve the `renderRow` host callback and the row data attributes.

Update `documentTree.css`:

- Remove `.document-tree-title-bar`, `.document-tree-header` and meta strips.
- Add the content-window layer and header-row shell styles.
- Header rows use `.row` geometry, content padding, hover/focus, keyword styling; no twisty and no ECUC selected styling.

## 3. Docs view header rows

In `editorViewer.ts`:

- Build `headerRows` from the document header: one schema row and one row per package. Stable IDs such as `header:schema`, `header:package:<index>`.
- Prepend them to the display row list. Each header row has a `haystack` and a `kind: 'header'` marker.
- `renderRow` renders header rows through the document row shell; header rows do not carry node IDs or ECUC selection data.
- `heightFn` and the precomputed offsets include header rows. The module gap rule remains.
- Search candidates combine header rows and node rows. Map search hits to display indices directly.
- Click/focus on a header row must not post `select` or change Details. Keep the search highlight and focus ring.
- Remove `applyHeader`/`setHeader` and the pinned header path.
- Preserve scroll position across re-scan and search jumps.

Add/update tests in `src/test/webview/page/render.test.ts` and the relevant interaction suites.

## 4. Editor uses VirtualScroll

In `editorViewer.ts`:

- Mount `VirtualScroll > DocumentTreeView`.
- On row/header/height changes, rebuild the offsets and call `setContent`.
- Replace direct `treeView.setScrollTop`/`scrollToIndex`/`clientHeight` calls with the VirtualScroll API.
- `scrollToIndex` and reveal must work for header rows as well as node rows.
- Keep selection, search, collapse, Details and sidebar behaviour unchanged.

## 5. Diff uses one shared VirtualScroll

In `diffView.ts` / `diffViewer.ts`:

- Layout: fixed file-name strip (two columns) outside `VirtualScroll`; `VirtualScroll` contains the left and right `DocumentTreeView` windows.
- Build one aligned virtual row list: header rows first (padded to the longer side with blank rows), then the existing `DiffDisplayRow` list.
- One shared `rowCount`/`offsets`/`totalHeight`/`contentWidth`.
- Both panes render their side of the same row index.
- Header rows render as a left/right pair; blank padding rows render as empty rows.
- Search candidates: one per aligned header row with a combined left/right haystack, plus the existing diff row candidates. One match per row.
- `Swap sides` swaps the fixed file-name columns, pane content and header order; scroll geometry stays.
- Context/gap rows remain after the header segment and never remove header rows.
- One vertical and one horizontal bar; pane split fixed; horizontal offset shared.
- Remove the per-pane vertical scrollers and the follower sync path.

Update `diffView.css`, `diffViewRender.ts`, and `diffPage.test.ts` / `diffView.test.ts`.

## 6. Tests and red checks

- VirtualScroll: offsets length, total height, visible range at top/middle/end, scroll-to-index, drag accuracy, horizontal offset, one callback per frame.
- DocumentTreeView: renders only the requested slice, positions the window at `offsets[start]`, header row interaction, no pinned header.
- Editor page: header rows in offsets, scroll out, search match + jump, click/focus no ECUC select/Details, module gaps preserved.
- Diff page: fixed file names outside scroll, one shared scroll surface, both panes render the same range, header padding, paired search, swap, context, selection.
- Red-check each new branch: remove it and confirm its test fails.

## 7. Docs and specs

- `docs/ECUC_EDITOR.md`: schema/package lines are content, no pinned header; scroll/search behaviour.
- `docs/DIFF.md`: fixed file names, one shared scroll surface, header rows, paired search.
- `.trellis/spec/frontend/components/component-document-tree.md`: window-renderer contract.
- `.trellis/spec/frontend/components/component-diff-view.md`: shared scroll and header model.
- `.trellis/spec/frontend/editor-lifecycle.md`: header rows and scroll lifecycle.
- `CHANGELOG.md` under `[Unreleased]`: content header and single diff scroll.

## 8. Verification

```powershell
npm run check-types
npm run lint
npm run compile-tests
node node_modules/mocha/bin/mocha.js --ui tdd "out/test/core/*.test.js" --ignore "out/test/core/uxNodeId.test.js"
npm test
npm run benchmark
npm run package
npx @vscode/vsce ls
```

If the VS Code download is unavailable, record the exact environmental error and still run the core and component suites.

## Review gates

- **Gate A:** docs view header rows are content, searchable, focusable and absent from Details; no pinned header remains.
- **Gate B:** diff has one VirtualScroll, one vertical bar, one horizontal bar, fixed file names and aligned panes.
- **Gate C:** scroll frames use precomputed offsets only; the thumb and drag match the rendered content.
- **Gate D:** full tests, benchmark, package and VSIX pass; specs/docs updated.

## Rollback

Revert the VirtualScroll and DocumentTreeView refactor together; restore the pinned header, per-pane scrollers and the current diff sync. No persisted state or migration is involved.
