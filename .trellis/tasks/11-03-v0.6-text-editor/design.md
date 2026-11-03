# Design: text-editor integration

## Pure extraction (`src/core/text/arxmlFeatures.ts`)

```ts
interface RefToken { rawPath: string; range: Range; kind: 'definition' | 'target' | 'context'; }
interface SymbolData { name; detail?; kind: 'module'|'container'|'parameter'|'reference'|'package';
                       range: Range; selectionRange: Range; children: SymbolData[]; }

refTokenAt(model, offset): RefToken | undefined
refTokens(model): RefToken[]
documentSymbols(model): SymbolData[]
```

`refTokenAt` checks `definitionRefRange`, `targetRange` and `context` ranges from the scanned model.
`documentSymbols` walks modules/containers recursively in declaration order; the range is the node
range, selection is the short-name range when present.

## Host providers (`src/host/textFeatures.ts`)

One `registerTextFeatures(context, indexService)`:

- `DocumentSymbolProvider` — scans the document (cached by URI + version), emits `DocumentSymbol`
  with `SymbolKind.Module` / `Namespace` / `Field` / `Reference`. For a non-ECUC file it uses
  `buildFileIndex` definitions and packages.
- `DefinitionProvider` — resolves `refTokenAt`; the target is an `IndexElement` or `IndexDefinition`
  location; uses `elementRange`/`definition.range` in that file.
- `ReferenceProvider` — finds the element at the cursor (short name, definition ref or reference
  target), then `index.referencesFor(element)`; also includes definition refs that resolve to it.
- `DocumentLinkProvider` — `refTokens` -> `DocumentLink(uri, range)`; target file with `#L<line>` when
  `lineStarts` is available.
- `HoverProvider` — target path, kind, and definition `type/range/description` in Markdown.

All providers use a small document cache and return `undefined`/`[]` for a missing index or a
non-`.arxml` document. Difference from the custom editor: these providers use the merged text
document, so unsaved text is visible.

## Registration

`extension.ts` calls `registerTextFeatures(context, indexService)` after the index service starts.

## Tests

- `src/test/core/arxmlFeatures.test.ts`: ref tokens, symbol tree, offset boundaries.
- `src/test/extension/textFeatures.test.ts`: temp workspace with values + module definition, reindex,
  then call the five `vscode.execute*Provider` commands at known offsets.
