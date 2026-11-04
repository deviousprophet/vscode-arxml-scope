# Design — validation false positives

## Boundaries

| Layer | Files | Change |
|---|---|---|
| Pure index | `src/core/index/workspaceIndex.ts` | candidate arrays, copy-aware resolution, multiple-copy reporting, definition candidate count |
| Pure index | `src/core/index/glob.ts` (new) | small glob matcher for excluded paths |
| Pure validation | `src/core/validation/validate.ts` | rule scoping, counting, missing-definition ancestor pass |
| Pure validation | `src/core/validation/types.ts` | `relatedInformation` on `EcucDiagnostic`; no rule id change |
| Pure rows | `src/core/ecuc/renderRows.ts` | ambiguous-definition count on the row |
| Host | `src/host/indexService.ts` | exclusion setting, filtered discovery and watcher, candidate passthrough |
| Host | `src/host/validationService.ts` | related information, diagnostic caps, coalesced refresh |
| Host | `src/host/ecucEditorProvider.ts` | pass the source file, multi-copy quick pick, ambiguous-definition callback |
| Host | `src/host/textFeatures.ts` | pass the document URI, exclude excluded documents, size cap, bounded cache |
| Webview | `src/webview/editorViewer.ts` | render `N definitions found` |
| Manifest | `package.json` | `arxmlScope.index.exclude`, `arxmlScope.validation.maxDiagnostics*` |
| Benchmark | `src/test/benchmarks/validationBenchmark.ts` (new) | validation time/heap budget |
| Docs | `README.md`, `docs/ECUC_EDITOR.md`, `CHANGELOG.md` | exclusion, caps, rule semantics |
| Spec | `.trellis/spec/frontend/quality-guidelines.md` | replace "two matches must resolve to nothing" with the copy-aware rule |

## 1. Candidate-aware resolution (`workspaceIndex.ts`)

Today `PathLookup` stores one item per path and collapses a second item to `undefined`. Replace the
value with a candidate list:

```ts
interface PathLookup<T> {
	exact: Map<string, T[]>;
	suffix: Map<string, T[]>;
}
```

`resolveDetailed` returns:

```ts
type Resolved<T> =
	| { status: 'found'; candidates: T[] }   // length >= 1
	| { status: 'absent' };
```

Ambiguity is decided per call, by the caller that knows the rule:

- `element()` and `definitionEntry()` keep today's contract: exactly one candidate → value,
  otherwise `undefined`. `definitionEntry` **never** applies the copy rule — two definitions may carry
  different bodies.
- `Paths` that repeat keep only the candidates that repeat; unique paths stay a one-element array.
  Cost is one array per path, and only repeated paths grow.

`ElementResolution`'s success variant gains the copy list:

```ts
| { ok: true; element: IndexElement; copies: readonly IndexElement[] }
```

### Copy rule (`resolveTarget`)

```ts
resolveTarget(rawPath: string, dest?: string, sourceFile?: string): ElementResolution
```

1. Resolve candidates (exact first, then suffix, as today).
2. Filter by `expectedKind(dest)` when the DEST names a kind; an empty filtered set keeps today's
   `dest-mismatch` against the first raw candidate.
3. One candidate → `ok` with `copies: [candidate]`.
4. Several candidates that are **not** copies → `ambiguous` (unchanged refusal).
5. Several copies:
   - more than one candidate with `file === sourceFile` → `ambiguous` (genuine same-file duplicates);
   - exactly one candidate in the referencing file → `ok`, `element` = that copy, `copies` = the full
     candidate list, ordered so the local copy is first;
   - none in the referencing file → `ok` (validation resolves), `element` = first by file path for
     compatibility, `copies` = every candidate sorted by `file`, then `range.start`.

`copiesOfOneIdentity(candidates)` = every candidate has the same `kind` and the same `definitionRef`.
A definition has no `definitionRef`; its identity is `kind` alone, but the function is only used for
elements — `definitionEntry` never calls it.

`sourceFile` is optional so existing call sites and tests keep compiling. `resolveReference` passes
`reference.file`. `referencesFor` compares `file` + `range` against the resolved `element`, so a
reference with a local copy lists references to that copy's path — the desired behaviour.

`WorkspaceIndex` gains `definitionCandidateCount(rawPath): number` (0/1/N) for R12.

### Why this is not "guessing"

Copies of one identity are the same AUTOSAR element declared twice. A reference to that path means the
element, not a particular file. Choosing the referencing file's copy is a scoping rule, not a guess.
Candidates that differ in `kind` or `DEFINITION-REF` remain ambiguous and still refuse.

### Multiple-location navigation

`resolveTarget` returns every copy in `copies`. Navigation consumers use them:

| Consumer | Behaviour |
|---|---|
| `TextFeatures.provideDefinition` | returns `vscode.Location[]`: one per copy when `copies.length > 1`; a single location otherwise; `undefined` for a definition token that is ambiguous |
| `EcucEditorProvider.followReference` | `copies.length > 1` → `showQuickPick` of `${fileName}:${line}` labels, then `openElement(chosen)`; cancel is a no-op. One copy → today's path |
| `referenceResolver` (row model) | `ok` → followable, unchanged; `ambiguous`/`absent` keep the refusal reason |

No navigation path silently picks the first copy.

## 2. Excluded paths (R8)

### Setting

```json
"arxmlScope.index.exclude": {
  "type": "array",
  "items": { "type": "string" },
  "default": [],
  "description": "Workspace-relative globs that are never indexed or validated (for example generated output: **/_fwd/**, **/_out/**, **/_gen/**)."
}
```

### Matcher decision

Use a small, in-repo matcher (`src/core/index/glob.ts`), not a bundled library:

- `quality-guidelines.md` forbids a new runtime dependency; `picomatch` would be the extension's first.
- The required syntax is narrow: `**`, `*`, `?`, `/` (normalize `\` to `/`), anchored to the whole
  workspace-relative path. `**/` matches zero or more segments.
- A regex compiler is ~40 lines and unit-testable; a library brings a larger bundled surface than the
  feature needs.
- `picomatch` stays the documented fallback if a later requirement needs braces/extglobs.

```ts
export function compileExcludes(patterns: readonly string[]): (relativePath: string) => boolean;
```

Empty list → `() => false`. Compiled once per settings read. A pattern with no wildcard ends with `/`
→ path prefix.

### Discovery, watcher, features

- `indexSettings()` gains `exclude: string[]`.
- `runRebuild`: `findFiles('**/*.arxml')` stays (it already honours `files.exclude`), then drop URIs
  whose `workspace.asRelativePath(uri, false)` matches. One matcher for discovery, watcher and text
  features instead of teaching VS Code's finder a second syntax.
- `schedule`/`reindexFile` ignore a matching URI; if a file becomes excluded, the existing
  configuration-triggered `rebuild()` removes it.
- Excluded open documents: `TextFeatures` checks the exclusion first and returns empty symbols,
  definitions, references, links and hover. Plain text editing is untouched. This is the preferred
  reading in the brief; the alternative (keep text features for open files) is an open decision.
- Status tooltip appends `N excluded` when the setting is non-empty.

## 3. Rule changes (`validate.ts`)

### 3.1 brokenReference / destMismatch (R2)

```ts
const CHECKED_TARGET_DESTS = new Set([
  'ECUC-MODULE-CONFIGURATION-VALUES',
  'ECUC-CONTAINER-VALUE',
]);
```

- `targetDest === undefined` → validate (today's behaviour).
- `targetDest` in the set → validate broken/ambiguous and `destMismatch`.
- Any other `targetDest` (non-ECUC or parameter-value) → skip silently, documented: the index gives
  parameters no path, and non-ECUC elements are not indexed, so no verdict is possible.

### 3.2 duplicateShortName (R3)

Group by `element.path`. Emit **one** diagnostic at the first element (file order, then offset):

```
SHORT-NAME "X" is declared N times for /path (M files).
```

- same-file group (M = 1): configured severity;
- cross-file group (M > 1): `information`, unless the rule is `off`;
- `relatedInformation`: one entry per other declaration (`file`, `range`, `Also declared here.`).

`add()` gains an optional severity override that still honours `off`. Diagnostics gain an optional
`related` array; `validationService` maps it to `vscode.DiagnosticRelatedInformation`.

### 3.3 multiplicity (R4)

Key becomes `file + '\u0000' + parent + '\u0000' + definitionRef` for elements and references. Count
only inside that key. The message names the scope: `"... occurs N times in this file; the definition
allows ..."`. Copies in other files are not summed.

### 3.4 missingRequired (R5, R9)

Skip a child when:

- `child.kind === 'ECUC-ADD-INFO-PARAM-DEF'` (R5), or
- `child.defaultValue !== undefined` (R9): a definition default satisfies the lower multiplicity.

R9 is the conservative reading. AUTOSAR ECUC's default value applies when the parameter is absent, so
the configuration is not missing data. If the specification check contradicts this, the fallback is to
report at `information`; that is an open decision, not a silent change.

### 3.5 valueOutOfRange (R6)

Before any type branch:

```ts
if (value.trim() === '') return undefined; // "use the default"
```

- Boolean: `true`, `false`, `0`, `1`, trimmed and case-insensitive.
- Float: `INF`, `-INF`, `NaN` are valid (AUTOSAR float literals); range checks apply only to finite
  numbers.
- Integer, string length, enumeration: unchanged.

### 3.6 missingDefinition (R7)

Replace the per-instance loop with one grouping pass:

1. Collect `missing: Map<string, Occurrence[]>` where an occurrence is an element or reference whose
   `definitionRef` is not in the index.
2. Build `moduleDefinitions` = the `definitionRef` values carried by `kind === 'module'` elements.
3. For each missing path, find its report root:
   - climb to the nearest ancestor that is also missing;
   - if any ancestor is in `moduleDefinitions`, use that module definition as the root;
   - otherwise the highest missing ancestor is the root.
4. Group occurrences by root. Emit one diagnostic at the root's first occurrence:

```
Definition "/AUTOSAR_ComM/EcucModuleDefs/ComM" is not in the workspace index (37 instances).
```

5. Drop the "root package has no indexed definitions" heuristic entirely.

A missing child under a present module definition has a present parent, so it is its own root and is
reported once at the child. A missing module definition absorbs its missing children into one
diagnostic with the summed occurrence count.

## 4. Host: performance and volume (R10, R11)

### 4.1 Validation pass

Per-file incremental validation is rejected: `duplicateShortName`, `multiplicity` and
`missingDefinition` are workspace-global, so a file-local pass would emit wrong counts. Use an explicit
budget instead:

- `ValidationService.refresh()` records the index generation before validating.
- A pass that finishes while a newer generation exists discards its result and reruns once (coalesce;
  the last generation wins). No partial publish: the previous diagnostics stay visible until the new
  full set is ready, so the panel never shows half a workspace.
- The pass yields to the event loop every N files/elements (`await new Promise(setImmediate)`) so the
  extension host stays responsive; the debounce stays 400 ms.
- Budget: full pass ≤ 5,000 ms for a 40 MiB synthetic workspace (baseline at plan time: 1.1 s at
  42 MB), retained heap ≤ 512 MiB. Both are benchmark-enforced.

Benchmark: `src/test/benchmarks/validationBenchmark.ts`, auto-discovered by `npm run benchmark`.
Synthetic: ~40 files, ~40 MiB total, with definitions, references, duplicates and missing definitions
so every rule runs. It prints `{ _type: 'validation', sourceMiB, records, elapsedMs, retainedMiB }` and
throws above budget.

### 4.2 Text-editor scans

`TextFeatures.cached()` scans the whole document on each new version. Add:

- size cap from `arxmlScope.index.maxFileSizeMB` (`document.getText().length > maxBytes` → empty
  result, cached per version so larger documents are not rescanned);
- cache bound (drop the least-recently-used entry above 8 documents) so long sessions cannot grow
  without limit;
- the existing version key already prevents a rescan for the same version; providers are pull-based,
  so no extra timer is added.

### 4.3 Diagnostic volume cap (R11)

Settings:

```json
"arxmlScope.validation.maxDiagnosticsPerFile": { "type": "number", "default": 500, "minimum": 0 },
"arxmlScope.validation.maxDiagnostics": { "type": "number", "default": 5000, "minimum": 0 }
```

`0` means unlimited. `validationService` walks the rule-ordered list, keeps per-file and total counts,
drops the excess deterministically (file order, then rule order), and appends one diagnostic per
affected file:

```
N additional problems in this file were hidden by the diagnostic limit.
```

No diagnostic is dropped without the summary. Defaults are an open decision.

## 5. Ambiguous definition in Details (R12)

`renderRows` already resolves `definitions` through `RowBuildOptions`. Add:

```ts
ambiguousDefinitions?: (definitionRef: string) => number;
```

`EcucRow` gains `definitionCount?: number`. `definitionFor` stays the only place a definition is
resolved; when it returns `undefined` and the count is ≥ 2, set `definitionCount`. The webview's
inspector fields then show `Definition type: N definitions found` instead of no definition block. The
editor still does not pick one.

`WorkspaceIndex.definitionCandidateCount` is the source; `IndexService` forwards it; the provider passes
both callbacks. `DefinitionLookup` and `DefinitionInfo` keep their shape (no breaking change for tests).

## 6. Call-site updates

| Caller | Change |
|---|---|
| `host/indexService.ts` | `resolveTarget`/`resolveReference` forward `sourceFile`; expose `definitionCandidateCount`; exclusion filter |
| `host/ecucEditorProvider.ts` | `DefinitionSource.resolveTarget` gains the optional third parameter; `definitionCount` callback; quick pick in `followReference` |
| `host/textFeatures.ts` | all `resolveTarget` calls pass `document.uri.toString()`; `provideDefinition` returns `Location[]`; exclusion and size guard |
| `host/validationService.ts` | related information, caps, coalesced generation-aware refresh |
| `webview/editorViewer.ts` | ambiguous-definition row |

## 7. Compatibility and rollout

- No rule id, message prefix or setting key is removed; every rule stays `off`-switchable.
- `resolveTarget` keeps its arity (new parameter optional); `element`/`definitionEntry` keep
  `T | undefined`.
- `PathLookup` is internal. Candidate arrays add memory proportional to duplicate paths; the
  `indexBenchmark` gate verifies the limit.
- Both new settings default to inert (`[]`, caps above the reference project's counts).
- No migration, no persisted state. Rollback is reverting the branch.

## 8. Spec and documentation updates (release step)

- `quality-guidelines.md`: exact path first, then a unique suffix. Candidates that differ in kind or
  `DEFINITION-REF` resolve to nothing; copies of one identity resolve to the referencing file's copy,
  or to every copy for navigation. Same-file duplicates stay ambiguous.
- `docs/ECUC_EDITOR.md`: `arxmlScope.index.exclude`, caps, R2 DEST scope, R4 per-file counting,
  R5/R9 required rules, R6 value semantics, R7 ancestor reporting, R12 Details text.
- `README.md`: exclusion setting and required checks.
- `CHANGELOG.md`: v0.6.1 entry (see Track A `implement.md`).

## 9. Risks

| Risk | Mitigation |
|---|---|
| Copy rule hides a genuine conflict | Applies only to equal `kind` + `DEFINITION-REF`; same-file duplicates stay ambiguous; navigation shows all copies |
| Navigation change breaks one-location expectations | `copies` is one element for the normal case; tests pin both paths |
| Glob matcher diverges from VS Code globs | Narrow syntax, unit-tested; documented as workspace-relative; `picomatch` is the escape hatch |
| Excluding a tree hides real problems | Explicit setting, status count, docs example |
| Missing-definition grouping hides a child error | Child reported when its parent definition is present; only a missing module absorbs its own missing subtree |
| Validation budget hides errors | No partial publish; the pass can exceed the budget only with a benchmark failure, not a silent truncation |
| Diagnostic cap hides errors | One summary diagnostic per file with the exact hidden count; caps default high and are configurable |
| Candidate arrays cost memory | `indexBenchmark` gate; arrays only for repeated paths |
| Ambiguous definition count adds a second lookup | It is one map read per row; the existing `definitions` lookup is unchanged |
