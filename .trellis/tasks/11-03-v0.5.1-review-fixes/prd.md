# v0.5.1: review fixes

## Context

Independent review of PR #14 found a P0 crash and several correctness gaps before v0.5.0 is tagged.

## Requirements

- **R1 (P0)** — `WorkspaceIndex` lookup rebuilding must not use array spread on per-file element lists. A file with 150k+ elements must resolve without `RangeError`.
- **R2** — A definition lookup failure must never block row building: the provider/row path returns no definition instead of throwing.
- **R3** — Capture `UUID` when ARXML writes it as an element *or* an attribute.
- **R4** — Honor `UPPER-MULTIPLICITY-INFINITE`: `true` displays as `*`, so a container reads `0..*`.
- **R5** — `runRebuild` must clear `building` in `finally` and publish status even when discovery/read fails. `start()` must not leave an unhandled rejection.
- **R6** — A watcher update that lands during a rebuild must not be overwritten by the rebuild's `replaceAll`; reindex those files after the replacement.
- **R7** — Add a headless large-index benchmark that reports build and lookup time/retained memory.
- **R8** — Document the remaining limitations: disk-only reads (unsaved definition edits), UTF-8 decoding, global lookup rebuild, and the two-parser split.

## Acceptance criteria

- A 200k-element `FileIndex` resolves an element and a definition without throwing; a test fails on the old spread.
- A definition lookup that throws leaves the row without a definition and the rest of the row document intact.
- UUID element and attribute forms both index; infinite multiplicity reads `0..*`.
- A failed rebuild leaves the status bar usable (not stuck on `indexing…`).
- A file changed during a rebuild is reindexed before the rebuilt document is published.
- `npm run check-types`, `npm run lint`, `npm test` and `npm run benchmark` pass.
- The v0.5.0 changelog remains accurate; no version bump for pre-tag fixes.
