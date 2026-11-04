# Design — validation false positives

## Boundaries

| Layer | Files | Change |
|---|---|---|
| Pure index | `src/core/index/workspaceIndex.ts` | identity-aware candidate resolution |
| Pure index | `src/core/index/glob.ts` (new) | minimal glob matcher for excluded paths |
| Pure validation | `src/core/validation/validate.ts` | rule scoping and counting |
| Pure validation | `src/core/validation/types.ts` | no change (rule ids stay stable) |
| Host | `src/host/indexService.ts` | exclusion setting, filtered discovery and watcher |
| Host | `src/host/validationService.ts` | no contract change |
| Host | `src/host/ecucEditorProvider.ts` | pass the source file into resolution |
| Host | `src/host/textFeatures.ts` | pass `document.uri` into resolution |
| Manifest | `package.json` | `arxmlScope.index.exclude`; cross-file duplicate severity stays informational by rule |
| Docs | `README.md`, `docs/ECUC_EDITOR.md`, `CHANGELOG.md` | describe the exclude setting and the rule semantics |
| Spec | `.trellis/spec/frontend/quality-guidelines.md` | replace "two matches must resolve to nothing" with the copy-aware rule |

## 1. Identity-aware element resolution

Current `PathLookup` stores exactly one item per path and collapses a second item to `undefined`:

```ts
function buildLookup<T>(items, pathOf): PathLookup<T> // exact: Map<string, T | undefined>
```

Change the lookup to retain the candidate list and the ambiguity decision:

```ts
interface PathLookup<T> {
	exact: Map<string, T[]>;
	suffix: Map<string, T[]>;
}
```

`resolveDetailed` returns:

```ts
type Resolved<T> =
	| { status: 'found'; value: T }
	| { status: 'ambiguous'; candidates: T[] }
	| { status: 'absent' };
```

- `element(raw)` and `definitionEntry(raw)` keep today's contract: `found` only when exactly one
  candidate, otherwise `undefined`. `definitionEntry` never uses the copy rule — two definitions with
  the same path may carry different bodies, and the editor must not pick one.
- Ambiguity is decided per call: `candidates.length === 1` → found, `0` → absent, `> 1` → ambiguous.

### Copy selection

A candidate set is *copies of one identity* when every candidate has the same `kind` and the same
`definitionRef` (for definitions: same `kind` and same normalized body fields; not needed because
`definitionEntry` does not use it). For element resolution:

```ts
resolveTarget(rawPath: string, dest?: string, sourceFile?: string): ElementResolution
```

1. Resolve candidates.
2. Filter by `expectedKind(dest)` when the DEST names a value kind; if the filtered set is empty and the
   raw set was found, return `dest-mismatch` using the first raw candidate (today's behaviour).
3. If one candidate: `ok`.
4. If several and they are not copies: `{ ok: false, reason: 'ambiguous', path }`.
5. If several copies:
   - pick the candidate with `file === sourceFile`;
   - otherwise pick the first candidate sorted by `file` (deterministic; copies are equivalent);
   - return `ok`.

`sourceFile` is optional so existing callers and tests keep compiling; without it the sorted-first copy
is used. `resolveReference` passes `reference.file`.

`referencesFor` compares `file` and `range`; with a copy chosen for a reference, "find references" now
lists the references that point at that copy's path, which is the desired behaviour.

### Why this does not violate "refuse rather than guess"

Copies of one identity are the same AUTOSAR element declared twice; choosing the local copy is not a
guess about *which element* the reference means. Two candidates that differ in `kind` or `DEFINITION-REF`
remain ambiguous and still refuse. The quality guideline is rewritten to say exactly this.

## 2. Excluded paths

### Setting

```json
"arxmlScope.index.exclude": {
  "type": "array",
  "items": { "type": "string" },
  "default": [],
  "description": "Workspace-relative globs that are never indexed (for example generated output such as **/_fwd/**, **/_out/**, **/_gen/**)."
}
```

### Matcher

`src/core/index/glob.ts`:

```ts
export function compileExcludes(patterns: readonly string[]): (relativePath: string) => boolean;
```

Supports `**`, `*`, `?` and path separators, normalizes `\` to `/`, anchors the whole relative path.
`**/` matches zero or more segments. Compiled once per settings read. A pattern with no glob characters
is treated as a path prefix when it ends with `/`.

### Discovery and watcher

- `runRebuild`: build a `vscode.RelativePattern`-free filter. `findFiles('**/*.arxml')` stays (it already
  honours `files.exclude`), then drop URIs whose workspace-relative path matches. This keeps one glob
  implementation instead of teaching VS Code's finder and the watcher two different syntaxes.
- `schedule`/`reindexFile`: ignore URIs that match; if a previously indexed file becomes excluded after a
  settings change, `onConfigurationChanged` runs a full `rebuild()` (it already does) which replaces the
  index.
- Status bar tooltip: append `N excluded` when the setting is non-empty; no new command.

`indexSettings()` gains `exclude: string[]`; `readFileIndex` is unchanged.

## 3. Rule changes (`validate.ts`)

### 3.1 brokenReference

Only references whose `targetDest` is an ECUC value kind are validated:

```ts
const ECUC_TARGET_DESTS = new Set([
  'ECUC-MODULE-CONFIGURATION-VALUES',
  'ECUC-CONTAINER-VALUE',
  'ECUC-REFERENCE-VALUE',
  'ECUC-INSTANCE-REFERENCE-VALUE',
]);
```

A missing `DEST` keeps today's behaviour (validate; the index can only match ECUC value paths anyway).
Non-ECUC DESTs produce no diagnostic, no "unvalidated" noise.

`destMismatch` is unchanged and still only fires for the three value kinds `expectedKind` knows.

### 3.2 duplicateShortName

Group by `element.path`; emit one diagnostic at the first element of the group (file order, then offset):

```
SHORT-NAME "X" is declared N times for /path (N files).
```

- same-file group: keep the configured severity;
- cross-file group: `information`, unless the rule is `off`.

`add()` gains an optional severity override that still honours `off`.

### 3.3 multiplicity

Key becomes `file + '\u0000' + parent + '\u0000' + definitionRef` for both elements and references.
Count only inside that key. A real over-occurrence in one file still reports at that file's first
element; copies in other files no longer add to it.

### 3.4 missingRequired

Skip children whose `kind === 'ECUC-ADD-INFO-PARAM-DEF'`. Documentation parameters are not configuration.

### 3.5 valueOutOfRange

In `valueProblem`, before any type branch:

```ts
if (value.trim() === '') return undefined; // "use the default"
```

Boolean: accept `true`, `false`, `1`, `0` (case-insensitive, trimmed). Integer/float/enum/length checks
stay.

### 3.6 missingDefinition

Collect the set of missing definition paths first, then emit one diagnostic per path at its first
occurrence (file, then offset). Message keeps the definition path and adds the occurrence count.

Skip a missing definition when its root package (`/First/Segment`) has no indexed definition:

```ts
const indexedRoots = new Set(definitions.map((d) => rootSegment(d.path)));
if (!indexedRoots.has(rootSegment(missing))) continue;
```

This separates "definition package not in this workspace" from "definition absent from an indexed
package". `/AUTOSAR_ComM/...` keeps its diagnostic because `AUTOSAR_ComM` has other definitions;
`/RB/RBA/rba_Nds/...` disappears when `rba_Nds` contributes nothing.

## 4. Call-site updates

| Caller | Change |
|---|---|
| `host/indexService.ts` | `resolveTarget`/`resolveReference` pass through; nothing else |
| `host/ecucEditorProvider.ts` | `resolveTarget(raw, dest, document.uri.toString())`; interface signature gains the optional third parameter |
| `host/textFeatures.ts` | all four `resolveTarget` calls pass `document.uri.toString()` |

## 5. Compatibility and rollout

- No rule id, message prefix or setting key is removed; users can still set every rule to `off`.
- `resolveTarget`/`resolveReference` keep their existing arity (new parameter optional).
- `PathLookup` is internal; `WorkspaceIndex.element` and `definitionEntry` keep returning
  `T | undefined`.
- Index memory grows by the candidate arrays. Today's `exact` map already holds one entry per path; the
  change only keeps duplicates that were collapsed to `undefined`. The indexBenchmark must stay within
  its limits (verify).
- New setting defaults to `[]`, so nothing changes until the user opts in. Rollback is reverting the
  branch; no data is written.

## 6. Spec and documentation updates (Phase 3)

- `quality-guidelines.md`: "Exact path first, then a unique suffix. Candidates that differ in kind or
  `DEFINITION-REF` resolve to nothing; copies of one identity resolve to the referencing file's copy,
  then the first by file name."
- `docs/ECUC_EDITOR.md`: document `arxmlScope.index.exclude` and the revised rule semantics
  (ADD-INFO, empty value, boolean `0/1`, one diagnostic per duplicate/missing definition).
- `README.md` "Good to know" already mentions the index; add the exclusion setting.
- `CHANGELOG.md` under `Unreleased`.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Copy rule hides a genuine conflict | Only applies when kind and `DEFINITION-REF` are equal; a differing candidate keeps `ambiguous` |
| Glob matcher diverges from VS Code globs | Narrow syntax (`**`, `*`, `?`), unit-tested; documented as workspace-relative |
| Excluding a directory silently hides real problems | Explicit user setting, status-bar count, docs example |
| Missing-definition root heuristic hides a real gap | Only suppresses when the *root package* is entirely absent; children of indexed packages still report |
| Candidate arrays cost memory on 200k-element indexes | `indexBenchmark` gate; arrays only allocated for paths that actually repeat |
