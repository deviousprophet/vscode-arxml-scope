# Quiet the index diagnostics when a folder is not a complete project

## Goal

Opening a single folder — or a lone ARXML file — must not paint every reference red. The user gets a
clear, switchable mode that says "this folder is a fragment, cross-file checks are off" instead of
hundreds of error squiggles.

## Context

The reported symptom: open a folder that is not a complete ECUC project and the editor is covered in
red error marks.

Verified in source (v0.6.0, `fix/validation-false-positives`):

- References resolve only against the in-memory index (`src/core/validation/validate.ts:68-89`).
- The index is built from `vscode.workspace.findFiles('**/*.arxml')`
  (`src/host/indexService.ts:233`). A folder that holds one module's configuration but not the ECUC
  definitions indexes values without definitions; a window with no workspace folder indexes nothing.
- `validateWorkspace` already reads `hasDefinitions` (`validate.ts:39`) but uses it **only** for
  `missingDefinition` (`validate.ts:176-197`). Value, multiplicity and required-child rules silently
  skip when a definition is absent (`validate.ts:109-115, 151-155, 211-214`).
- Therefore the two rules that fire on an empty or definition-free index are
  `brokenReference` (default `error`) and `duplicateShortName` (default `error`) —
  `src/core/validation/types.ts:42-50`. That is the red flood.
- `brokenReference` is currently the only way to see a genuinely broken target, so it cannot simply be
  turned off globally; and `arxmlScope.validation.severities.brokenReference = "off"` already exists
  but is per-rule, undiscoverable, and also disables the check inside real projects.

## Requirements

- **P1 — Fragment detection.** The workspace is a fragment when the index contains **no ECUC definition**
  (`*-DEF`), i.e. `definitions.length === 0`, which is exactly the condition the index already exposes.
  A window with no workspace folder is a fragment too, because discovery yields nothing.
- **P2 — Setting.** Add `arxmlScope.validation.crossFileRules` with values `auto` (default), `always`,
  `never`:
  - `auto` — cross-file rules run only when the index has at least one definition;
  - `always` — today's behaviour, unconditionally;
  - `never` — cross-file rules never run, even in a complete project.
  `auto` is behaviour-preserving for every complete project, so upgrading users see no change.
- **P3 — What "cross-file" means.** `brokenReference`, `destMismatch`, and `duplicateShortName` for a
  path declared in more than one file. Same-file `duplicateShortName` keeps running: it needs no other
  file. `valueOutOfRange`, `multiplicity` and `missingRequired` already no-op without definitions and
  are untouched.
- **P4 — Visible state, no nagging.** The status bar reports the mode, e.g.
  `$(database) ARXML Scope: 12 files indexed · cross-file checks off (no project)`, with a tooltip that
  names the setting. Clicking it runs a command that cycles `auto` / `always` / `never` for the current
  workspace. No modal dialog, no notification, no red/green decoration on the item.
- **P5 — Live re-evaluation.** When the index gains or loses its last definition (rebuild, watcher,
  setting change), diagnostics are recomputed and the status text updates; no window reload.
- **P6 — Everything else is unchanged.** Navigation, hover, links, outline, details and the diff keep
  working exactly as today; an unresolved reference simply produces no diagnostic. No persisted state.
- **P7 — Tests.** Unit tests for `validateWorkspace` (fragment suppresses the P3 rules, complete
  workspace unchanged, forced `always` reproduces v0.6 output, forced `never` suppresses even with
  definitions) and host tests for the mode read, the status text, and the recompute on index change.
  Every test must fail when its branch is removed.
- **P8 — Docs.** `README.md`, `docs/ECUC_EDITOR.md`, `CHANGELOG.md` and the validation spec describe
  the setting and the fragment rule.

## Non-goals

- Auto-detecting "these files are generated" or "this folder is one module" beyond `definitions.length`.
- Suppressing diagnostics inside a complete project; that stays an explicit per-rule severity choice.
- Persisting a per-folder mode outside VS Code settings.
- Changing the index, resolution, navigation or the diff.

## Acceptance criteria

- [ ] A folder with ECUC values but no `*-DEF` definition produces no `brokenReference`, no
      `destMismatch` and no cross-file `duplicateShortName`, both in the Problems panel and as editor
      squiggles.
- [ ] The same fragment with `crossFileRules = "always"` reproduces today's diagnostics exactly.
- [ ] A complete workspace (at least one definition) with `auto` produces the same diagnostics as
      v0.6.0, including `brokenReference` for a genuinely missing target.
- [ ] `crossFileRules = "never"` suppresses the three rules even when definitions exist, and keeps
      same-file `duplicateShortName`, `valueOutOfRange`, `multiplicity` and `missingRequired`.
- [ ] A window with no workspace folder shows `0 files indexed` and no red diagnostics.
- [ ] Adding the missing definitions to the open folder (or rebuilding) flips the status back and the
      diagnostics appear without a reload.
- [ ] No dialog or notification is shown in any of the above.
- [ ] `npm run check-types`, `npm run lint`, `npm test`, `npm run benchmark` and `npx @vscode/vsce ls`
      pass; every new test fails when its branch is removed (mutation check).

## Notes

- Origin: user report — "opening a folder without a complete project workspace marks errors red
  everywhere".
- The setting is the user's explicit bypass; `auto` is the default so the annoying case is quiet
  without configuration. The manual `never` escape covers a fragment that does contain some
  definitions (for example a project split across folders).
- Related but separate: `11-04-validation-false-positives` fixes false positives inside an indexed
  workspace; this task only changes what runs when there is no usable definition model. Shared release
  steps live in that task's `implement.md` section 8.
- Open decision: the exact setting name and the status wording. Both are cheap to change before
  release.
