# Implementation plan: ECUC definition resolution

1. Add `src/core/index/definitions.ts` with `DefinitionInfo`, normalization and
   `resolveDefinition` over a definition map.
2. Add `WorkspaceIndex.definition(ref)` and `definitionMap` to the index child surface if missing;
   otherwise build the map from `files`.
3. Add `RowBuildOptions.definitions?: DefinitionLookup` and `EcucRow.definition` in
   `src/core/ecuc/renderRows.ts`; enrich module/container/parameter/reference rows only on a hit.
4. Extend `InspectorFields` and `updateInspector` with the definition rows in the documented order.
5. Pass `ref => indexService.definition(ref)` from `EcucEditorProvider`; subscribe to index changes
   and re-push open panels.
6. Add `src/test/fixtures/index/definitions.arxml` and core tests for every normalization row plus
   exact/ambiguous resolution.
7. Add row and details projection tests; add an extension assertion for the provider payload.
8. Run `npm run check-types`, `npm run lint`, `npm test`.

Rollback point after step 3: rows keep only the optional field, so removing the provider lookup
returns the editor to v0.4 details with no dead code outside the definition module.
