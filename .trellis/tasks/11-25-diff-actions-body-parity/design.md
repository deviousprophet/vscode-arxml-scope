# Design — diff actions and body parity

## Shared surfaces

- `src/webview/diffMonaco.ts` owns the diff editor, toolbar callbacks, change navigation, gutter actions and folding actions.
- `src/webview/monaco/synthetic.ts` builds the two diff-side synthetic documents. `buildSyntheticDocument` (editor) starts every fold range on the owning node line; `buildDiffSyntheticDocuments` currently starts at the opening brace line.
- `src/webview/editorMonaco.ts` is the parity target. Its editor options include `folding: true`, `showFoldingControls: 'mouseover'` and `stickyScroll: { enabled: true, defaultModel: 'foldingProviderModel' }`.
- `src/webview/monaco/setup.ts` holds the shared editor factory and folding-range provider.

## Root causes

1. **Prev/Next stalls.** `findForwardChange` uses `changeLine(change) >= current`, so after revealing a change the same change is selected again. `changeLine` also ignores Swap, so the revealed line can belong to the hidden model.
2. **Folding is per-model.** Each diff side has its own text model and its own Monaco `FoldingController`. Nothing mirrors hidden areas by row key.
3. **Fold ranges start on braces.** `openSideBlock` records the brace line as the fold start. The editor records the owning node line. Monaco folds from that start, so the diff hides the header and leaves only the brace line; sticky scroll therefore renders `{`.
4. **Sticky model differs.** Diff inner editors use Monaco's default `outlineModel`; the editor explicitly uses the folding provider.

## Boundaries and contracts

- Keep Monaco as the owner of folding and sticky scroll. Do not build a custom overlay or parse the DOM.
- Navigation stays line-based over `getLineChanges()`. Extract the pure index arithmetic so it can be unit-tested without loading Monaco.
- Collapse sync is keyed by the semantic row key, not by line number. The per-side line-key arrays already produced by `buildDiffSyntheticDocuments` are the mapping.
- Folding ranges must start on a line that has a row key; that is what makes key-based sync possible.
- No protocol change: the host payload already carries everything needed.

## Child sequence

1. `diff-collapsed-row-parity` changes the diff fold range start to the node line.
2. `diff-synced-folding` uses those node-start ranges to mirror collapsed row keys.
3. `diff-sticky-header-parity` sets the folding-provider sticky model and verifies the full header; it depends on (1).
4. `diff-prev-next-navigation` is independent.

## Verification shape

- Pure unit tests for change-index arithmetic and row-key mapping.
- A preview probe for each behaviour: navigation sequence, hidden row keys on both panes, collapsed node text, and sticky header text.
- Full seeded preview set plus the product gates in the parent `implement.md`.

## Rollback

Revert the child commits. No persistence or wire-format migration.
