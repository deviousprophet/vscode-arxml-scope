# Design — synchronized diff folding

## Prerequisite

`11-25-diff-collapsed-row-parity` must land first: diff fold ranges start on the node line, so every hidden range start has a semantic row key.

## Access to fold state

Monaco exposes `editor.getContribution('editor.contrib.folding')`. The pinned FoldingController exposes:

- `getFoldingModel(): Promise<FoldingModel>`
- `model.regions.length`
- `model.regions.getStartLineNumber(index)`
- `model.regions.isCollapsed(index)`
- `model.regions.findRange(line)`
- `model.toggleCollapseState([{ regionIndex }])`

Declare the minimal contribution surface in `monacoInternals.d.ts`, as the gutter adapter already does for pinned internals.

## Sync contract

Store the per-side line-key arrays from `buildDiffSyntheticDocuments`.

On `editor.onDidChangeHiddenAreas`:

1. Read the source fold model.
2. Build `Set<rowKey>` of collapsed ranges whose start line maps to a key.
3. Read the target fold model and build its collapsed key set.
4. For each key present in both models whose collapsed state differs, find the target region index by the target row line and toggle it.
5. Set a `syncing` flag around the target toggles so the target event does not bounce back.

Use row keys from the side arrays, not line offsets; one-sided rows have no partner.

## Pure seam

Extract `foldedRowKeys(regions, keys)` and `foldTogglePlan(collapsedSource, collapsedTarget, targetLineByKey)` into `diffFolding.ts` for unit tests. The Monaco contribution is the thin adapter.

## Tests

- Unit test key extraction, one-sided keys and toggle plans.
- Preview: a `diff-folds` state collapses `Items` on one side, records hidden keys on both, expands, then repeats from the other side. Audit fails on mismatched sets.

## Rollback

Revert the child commit; each pane returns to independent folding.
