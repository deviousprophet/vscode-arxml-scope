# v0.5: workspace index and ECUC definitions

## Goal

Deliver the v0.5 roadmap slice from `ARXML_EXTENSION_FEATURE_PLAN.md`:

- a streaming parser and an in-memory workspace index;
- ECUC definition resolution, with type, range, default, multiplicity and description in Details;
- a status bar with the indexed file count.

No derived file, cache or index is written beside user files. The index lives in memory for the
extension session and is rebuilt on activation.

## Task map

| Task | Delivers | Independent acceptance |
|---|---|---|
| `11-03-v0.5-workspace-index` | Chunk-fed XML stream parser, per-file index builder, in-memory workspace index, file-watcher refresh, status bar item, reindex command | Index tests, watcher/status-bar extension test |
| `11-03-v0.5-definition-resolution` | Definition lookup by AR path and Details rows for type, range, default, multiplicity, description, enum literals | Definition resolution unit tests, row/details tests |

The index child lands first because the definition child depends on the index model and lookup
surface. Both children are independently verifiable; the parent is not an implementation target.

## Cross-child acceptance criteria

- `npm run check-types`, `npm run lint` and `npm test` pass with both children landed.
- `src/core/**` keeps its no-`vscode`/no-DOM rule.
- A workspace with no `.arxml` file hides the status bar instead of showing `0 files`.
- Editing an indexed file updates its entries without rebuilding other files.
- Definitions remain optional: a missing or ambiguous definition adds no Details rows and never
  blocks the editor.
- No cache, index or derived file is written beside a user's ARXML.

## Out of scope for v0.5

- Cross-file Jump to target / Find All References (v0.6).
- Diagnostics (v0.6).
- Bundled XSDs and schema-aware completion (v0.7).
