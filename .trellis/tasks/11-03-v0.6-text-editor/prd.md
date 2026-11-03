# v0.6: text-editor integration

## Requirements

- **R1 — Document symbols.** Outline and breadcrumbs for ECUC-Values files (module -> container ->
  parameter/reference) and for definition files (module/container/parameter/reference definitions).
- **R2 — Go to Definition.** On a `DEFINITION-REF` value, navigate to the indexed definition; on a
  `VALUE-REF` / `TARGET-REF`, navigate to the indexed target element.
- **R3 — Find References.** On a module/container short name or definition, return every reference
  value that resolves to it, across files.
- **R4 — Document links.** Every `*-REF` value that resolves becomes a link to its target file (and a
  line fragment when available).
- **R5 — Hover.** A reference or definition ref shows the target path, element kind and, when
  available, the definition type/range/description.
- **R6 — Diagnostics.** The validation collection is already registered; the text editor shows it
  without a second diagnostic path.

## Acceptance criteria

- Pure extraction tests cover `*-REF` values and document-symbol ordering.
- Extension tests drive `vscode.executeDocumentSymbolProvider`, `executeDefinitionProvider`,
  `executeReferenceProvider`, `executeDocumentLinkProvider` and `executeHoverProvider` on temp
  workspace files, and assert a non-empty result.
- A non-ARXML file and a disabled index return no provider result.
- `npm run check-types`, `npm run lint` and `npm test` pass.
