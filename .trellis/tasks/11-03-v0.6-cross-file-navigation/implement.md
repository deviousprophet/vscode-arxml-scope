# Implementation plan: cross-file navigation

1. Add `ElementResolution`, `ReferenceResolution`, `resolveTarget`, `resolveReference` and
   `referencesFor` to `core/index/workspaceIndex.ts`; reuse the existing exact/suffix maps.
2. Add `RowBuildOptions.referenceResolver` and the `referenceRow` followable rule.
3. Extend `NodeEntry` with the element's AR path (reverse lookup in `model.pathIndex`) for
   find-references.
4. Extend `DefinitionSource` and `IndexService` with `resolveTarget` / `referencesFor`.
5. Provider: replace the same-file-only follow with the ordered cross-file path; add `findReferences`
   and the Details action.
6. Protocol/page: add the `references` message and button.
7. Tests: core resolver, row followable, provider follow/list, one extension flow.
8. Run `npm run check-types`, `npm run lint`, `npm test`.

Rollback: delete the new resolver methods and the `references` message; the v0.5 same-file follow path
stays as the fallback.
