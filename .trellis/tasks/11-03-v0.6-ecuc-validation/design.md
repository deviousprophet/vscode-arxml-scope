# Design: ECUC validation

## Index additions

- `IndexElement.sourcePath?: string` — the enclosing module/container path for a parameter.
- `IndexElement.value?: string` — decoded `<VALUE>` text for a parameter.
- `FileIndex.lineStarts: number[]` — offsets of every line start, built while streaming text.
- `WorkspaceIndex.files()` — read-only file list for the rule engine.

`IndexBuilder` records line starts in `write` and sets `sourcePath` the same way references do.

## Rule engine

`src/core/validation/` owns types + rules; no `vscode` import.

```ts
export type DiagnosticRule = ...;
export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'off';
export interface EcucDiagnostic { rule; severity; message; file; range; }
export interface ValidationOptions { severities: Record<DiagnosticRule, DiagnosticSeverity>; }
export function validateWorkspace(index: WorkspaceIndex, options: ValidationOptions): EcucDiagnostic[];
```

Rules share one precomputed context:

- definitions by path, elements grouped by parent path, references grouped by source path.
- `resolveReference` from the navigation child for broken/DEST checks.
- `resolveDefinition` for type/range/multiplicity.

Range/comparison helpers are pure. Integers use `BigInt`; floats use `Number`; strings compare
`Array.from(value).length` so astral characters count once.

Multiplicity is evaluated per parent: containers by `parentPath|definitionRef`, parameters and
references by `sourcePath|definitionRef`, modules by `definitionRef`. One diagnostic per violating
group, anchored at the first instance.

Missing-required uses direct child definitions (`<defPath>/<name>` with no further slash) and the
instance maps. A missing definition is skipped when the workspace contains zero definitions.

## Host

`src/host/validationService.ts`:

- creates `languages.createDiagnosticCollection('arxmlScope')`;
- subscribes to `IndexService.onDidChange`, debounces 400 ms, runs the engine;
- converts offsets with `lineStarts` to `vscode.Range`;
- clears and republishes every run; `enabled=false` clears immediately;
- disposes the collection and timer.

Settings are read per run, so a change applies without reload.

## Tests

- `src/test/core/validation.test.ts` builds `FileIndex` values directly or from inline ARXML and
  asserts one diagnostic per rule.
- `src/test/core/position.test.ts` checks offset-to-line conversion with LF/CRLF.
- `src/test/extension/validation.test.ts` writes temp files, calls `reindex`, waits for
  `getDiagnostics`, and checks the code. It also flips `enabled` off and expects an empty list.
