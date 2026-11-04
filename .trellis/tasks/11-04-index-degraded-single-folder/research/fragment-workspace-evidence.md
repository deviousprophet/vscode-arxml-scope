# Research — fragment workspaces and the red diagnostic flood

## Symptom

Open a folder that is not a complete ECUC project → red errors on most reference lines.

## Trace

1. `IndexService.start()` (`src/host/indexService.ts:92-115`) starts a rebuild for the first folder.
2. `runRebuild` discovers with `vscode.workspace.findFiles('**/*.arxml')` (`indexService.ts:233`) and
   indexes every file it can read.
3. `ValidationService.refresh()` (`src/host/validationService.ts:52-81`) calls `validateWorkspace` over
   that index and publishes the result.
4. `validateWorkspace` (`src/core/validation/validate.ts:14-247`):
   - `hasDefinitions` is computed at line 39 and used **only** for `missingDefinition`
     (lines 176-197);
   - `valueOutOfRange` skips a parameter with no resolvable definition (lines 109-115);
   - `multiplicity` skips a group with no resolvable definition (lines 151-155);
   - `missingRequired` skips an element with no resolvable definition (lines 211-214);
   - **`brokenReference` and `destMismatch` do not look at `hasDefinitions` at all** (lines 68-89);
   - **`duplicateShortName` does not either** (lines 92-105).

So a definition-free index emits exactly two rule families: `brokenReference` / `destMismatch` for every
reference, and `duplicateShortName` for repeated AR paths. Defaults are `error`, `warning`, `error`
(`src/core/validation/types.ts:42-50`), which is the reported red flood.

## Why "not a complete project" is detectable

An ECUC ARXML carries both the configuration (`ECUC-MODULE-CONFIGURATION-VALUES`) and the definition
packages (`ECUC-MODULE-DEF`, `ECUC-PARAM-CONF-CONTAINER-DEF`, …). The index already separates
`file.definitions` from `file.elements` (`src/core/index/indexModel.ts`), so
`definitions.length === 0` is a direct, data-driven "no definition model available" signal — no name or
path heuristic needed. The v0.6.0 `missingDefinition` rule uses the same flag.

A folder that is one module's configuration without its definitions is the common real case; a window
with no workspace folder yields an empty index (`findFiles` finds nothing), which satisfies the same
condition.

## Existing escape hatches

- `arxmlScope.validation.enabled` (`package.json:177`) turns the whole engine off.
- `arxmlScope.validation.severities` (`package.json:182`) accepts `"off"` per rule, including
  `brokenReference`.
- Neither is discoverable for this problem: the first loses every rule, the second is buried and
  applies everywhere, not just to fragments.

## Constraints

- `validateWorkspace` is pure and unit-tested directly (`src/test/core/validation.test.ts`); the mode
  must be a parameter, not a `vscode` read inside the core.
- `ValidationService` owns the settings read and the diagnostic collection; `IndexService` owns the
  status bar item and its tooltip (`indexService.ts:42-47`, `statusBarText`).
- No new dependency, no persisted state, no modal UI (repository quality rules).
- Track A will add `relatedInformation`, caps and a bounded pass to the same two files; this task must
  stay compatible with those additions (a mode filter, not a second pass).

## Open questions

- Setting name and status wording are undecided; behaviour is not.
- Whether `never` should also be offered as a per-workspace setting in `.vscode/settings.json` (it
  already is, as a normal VS Code setting) or via a command — the plan proposes both: the setting plus a
  status-bar command that cycles it.
