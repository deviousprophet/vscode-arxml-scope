# Research — rename matching in the semantic diff

## Current pairing (v0.6.0, `src/core/diff/diffModel.ts`)

`mergeChildren` calls `pairLevel(leftChildren, rightChildren)` per parent level. Passes, in order:

1. **Content identity** within a same-`baseId` group (`subtreeIdentity` then `sortIdentity`).
2. **Exact row id** (`row.id`).
3. **Ordinal-free base id** (`baseId`) when exactly one candidate remains on each side.

`baseId` removes `#<ordinal>` segments only. Row ids embed the short name and the parent id, e.g.
`container:NMH_MO_01_MAIN_BUS#0/param:SomeParam#0`, so any rename changes the id of the container and of
every descendant.

## Consequence of a rename

Synthetic example: left has `NMH_MO_01_MAIN_BUS` with a parameter `P`; right renames the container to
`NM_MO_01_MAIN_BUS` and keeps `P` with a value that repeats the old name.

- The container ids differ → no identity pass pairs them → `removed` + `added`.
- `P`'s id embeds the changed parent id → also `removed` + `added`.
- Any reference target or callback value containing `NMH` shows as a `target`/`value` change on rows that
  did pair.

Across a batch (the brief's example renames `NMH_*` → `NM_*` across many containers), every rename
produces two side rows instead of one changed row, and the count of rows explodes.

## Where the pass plugs in

| Symbol | Role |
|---|---|
| `pairLevel` | per-parent pairing; the semantic pass runs after the existing passes |
| `mergeChildren` | left order + right-only queue; needs the relative context |
| `pairedNode` | builds the changed/unchanged node and merges children |
| `sideNode` | removed/added nodes; keys prefixed `right:` for additions |
| `diffChanges` | compared fields (value, target, short name, definition ref/dest, variant, condition, context) |
| `summarizeDiff` | status counts |
| `diffVisibility` / `nextChangeIndex` | Show-diff-only and Prev/Next; both use `status` |

## UI surfaces

- `src/webview/diffViewer.ts`: `renderRow` sets `data-status`, renders the sibling badge and word diffs
  through `wordDiffForRow`; `hasChanges()` reads `summary.changed/added/removed`; the empty state says
  `No differences`.
- `src/webview/components/toolbar/toolbar.ts`: `renderDiffToolbarHtml` and `DiffToolbar` own the View
  switch, Prev/Next and Swap; a match-mode button fits in `.toolbar-left`.
- `src/host/diffPanel.ts`: reads both files, builds the document, debounces refresh (150 ms) and
  generation-guards it; the webview protocol is `src/diffProtocol.ts`.
- `src/test/core/diffModel.test.ts` pins the strict behaviour (renames currently show removed + added,
  moved containers stay removed + added).

## Constraints found in the repo

- `diffModel` is pure: no `vscode`, no DOM; the page imports it, so all scoring must stay synchronous and
  dependency-free.
- `package.json` has no runtime dependencies; the diff feature must not add one.
- `src/test/benchmarks/ecucLargeFileBenchmark.ts` already builds both sides through the real
  `scanEcucValues` + `buildRows` + `buildDiffDocument` pipeline and prints `summary.changed/added/removed`;
  the semantic benchmark follows the same shape and adds `renamed`.
- `src/test/fixtures/**` is pinned (`-text` in `.gitattributes`); new fixtures are synthetic only.

## Missing evidence to collect during implementation

- The exact worst-case bucket shape in the reference project is unknown; the benchmark uses the stated
  budget (2,000 leftovers, 500 × 400 worst bucket) rather than customer data.
- No customer ARXML is available or used; all examples are synthetic.
