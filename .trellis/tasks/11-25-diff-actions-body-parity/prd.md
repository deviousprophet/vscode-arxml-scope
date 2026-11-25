# Align diff view actions and body with the ECUC editor

## Goal

Make the diff view's navigation, folding, collapsed-row rendering and sticky headers behave and look like the ECUC editor, while keeping the native Monaco diff surface.

## Requirements

- **Prev/Next diff.** Each press advances to the adjacent change, wraps at the ends, reveals the change on the currently displayed pane and works after Swap.
- **Synchronized folding.** Collapsing or expanding a container on either side applies the same fold state to the matching container on the other side.
- **Collapsed-row parity.** A collapsed container or module leaves its full node header visible with the same fold hint and layout as the ECUC editor, rather than showing only a brace line.
- **Sticky-header parity.** The sticky header above the diff shows the full parent container/module header, matching `stickyScroll.defaultModel: 'foldingProviderModel'` in the editor.
- **No regressions.** Merge gutter actions, copy availability, sash resizing, find, search and the existing diff body paint keep working.

## Acceptance criteria

- [ ] Next/Prev visits every change once per cycle, wraps, and works before and after Swap.
- [ ] Folding either pane hides and restores the same row keys in both panes.
- [ ] Collapsing a container or module in the diff preserves its full node line and editor-style fold hint.
- [ ] The sticky header text matches the editor's parent-header text, not `{`.
- [ ] The parent integration runs the full preview set, unit tests, types, lint, fallow and production bundle.
- [ ] Each child task's own acceptance criteria pass.

## Non-goals

- Replacing the native diff body or folding engine.
- Editing content in the diff.
- Changing merge-copy semantics or gutter availability.
- Adding a second custom minimap, outline or sticky-header implementation.

## Child map

| Child | Deliverable | Order |
|---|---|---|
| `11-25-diff-prev-next-navigation` | Adjacent-change navigation and Swap-aware reveal | Independent |
| `11-25-diff-collapsed-row-parity` | Fold ranges start on the owning node line | Before sync and sticky |
| `11-25-diff-synced-folding` | Mirror fold state across panes by row key | After collapsed-row parity |
| `11-25-diff-sticky-header-parity` | Full sticky parent headers in both panes | After collapsed-row parity |
