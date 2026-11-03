# Design: cross-file navigation

## Core

`WorkspaceIndex` gains a discriminated resolution surface:

```ts
export type ElementResolution =
  | { ok: true; element: IndexElement }
  | { ok: false; reason: 'absent' | 'ambiguous'; path: string };

export type ReferenceResolution =
  | { ok: true; element: IndexElement; reference: IndexReference }
  | { ok: false; reason: 'no-target' | 'absent' | 'ambiguous' | 'dest-mismatch'; reference: IndexReference; target?: string; actualKind?: IndexElement['kind'] };

resolveTarget(rawPath, dest?): ElementResolution
resolveReference(reference): ReferenceResolution
referencesFor(target: IndexElement): IndexReference[]
```

`buildLookup` already stores `undefined` for a duplicate key; the resolver treats
`map.has(key) && map.get(key) === undefined` as ambiguous. `referencesFor` resolves every indexed
reference and keeps the ones whose target file and range equal the requested element. It is a
user-initiated query, so an O(references) scan is acceptable and avoids a second map.

`DEST` matching maps the AUTOSAR DEST to the index kind. An absent `DEST` accepts any kind; an
unknown DEST accepts any kind but is reported by validation (not navigation).

## Row model

`RowBuildOptions.referenceResolver?: (rawPath: string, dest?: string) => boolean`. `referenceRow`
sets `followable` when either the same-file `pathIndex` resolves or the workspace resolver accepts
the target. The `EcucRow` shape does not change; the host still owns the reason notice.

## Host

`DefinitionSource` (the provider's index seam) gains optional `resolveTarget` and `referencesFor`.
The provider keeps the same-file fallback when the index is unavailable.

`followReference`:
1. `resolveTarget(reference.targetRawPath, reference.targetDest)`.
2. Same file: select the row through `nodeIdForRange`.
3. Other ECUC-Values file: open the document, scan it, map the element range to a node id, call
   `selectNode(uri, id)`.
4. Other file: `revealRangeInTextEditor` at the element range.
5. Refusal: post the reason to Details.

`findReferences`:
1. `buildNodeIndex(model).byId.get(nodeId)`; require a module/container path.
2. `referencesFor({ file, range, kind, path })`.
3. `showQuickPick` with file:line and the reference definition tail.
4. On pick, reveal the reference range in the text editor.

## Protocol and page

Add `{ type: 'references'; nodeId: string }` to `EditorWebviewToProvider`. The Details actions add a
**Find references** button for module and container rows; it posts the existing node id and does not
change the row data.

## Tests

- `workspaceIndex.test.ts`: cross-file exact/suffix resolution, absent, ambiguous, DEST mismatch,
  `referencesFor` isolation.
- `renderRows.test.ts`/new test: cross-file resolver marks a reference followable.
- `indexDefinitions.test.ts`: extend the stub source and assert the provider follows a cross-file
  target and lists references.
- Extension test: two temp files, one reference, `executeCommand` path if practical.
