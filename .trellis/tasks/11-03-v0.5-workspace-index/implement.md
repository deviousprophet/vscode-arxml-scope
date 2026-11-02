# Implementation plan: streaming workspace index

1. Add `src/core/text/xmlText.ts` (`decodeXml`) and point `scanner.ts` at it. Run the scanner suite.
2. Add `src/core/index/xmlStream.ts` and `src/test/core/xmlStream.test.ts` with chunk-boundary cases.
3. Add `src/core/index/indexModel.ts`, `indexBuilder.ts` and a core fixture set under
   `src/test/fixtures/index/` (module values, module definition, split package).
4. Add `workspaceIndex.ts` with exact/suffix/ambiguous lookup, stats, upsert/remove and change
   callback. Test upsert/remove isolation.
5. Add `src/host/indexService.ts`: discovery, streaming read, size guard, watcher debounce, status
   bar, reindex command. Extend `package.json` with the two settings and the command.
6. Wire `extension.ts` and `commands.ts`; expose an API object from `activate` for tests:
   `{ indexStats, statusBarText, reindex }`.
7. Add an extension suite that builds a temp workspace, checks the status bar, edits one file, and
   deletes it. Use the existing `sleep` helper for watcher settling.
8. Add `examples/synthetic-module-def.arxml` and update `examples/README.md`.
9. Run `npm run check-types`, `npm run lint`, `npm test`.

Ordering note: the definition child consumes `IndexDefinition` and `WorkspaceIndex.definition()`
from this task; do not change those shapes without updating the definition task.

Rollback point after step 4: the core index exists and is tested but not wired; deleting the host
service returns the extension to v0.4 behaviour.
