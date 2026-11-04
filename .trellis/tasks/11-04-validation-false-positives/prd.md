# Fix ECUC validation false positives on duplicate and generated ARXML workspaces

## Goal

Make the v0.6 ECUC validation rules trustworthy on real automotive projects: the Problems panel must
show the user's real errors, not artifacts of generated copies, non-ECUC references, documentation
parameters or copied workspace trees. Navigation and text-editor features must use the same corrected
resolution, and the validation pass must stay bounded on large workspaces.

Ships as part of v0.6.1 together with `11-04-diff-semantic-rename-matching`.

## Context

A run of v0.6.0 on a 1,594-file, 359 MB ECUC project produced 61,566 diagnostics, of which roughly
54,000 were false positives. Measurements and samples are in `research/validation-false-positives.md`.
Additional synthetic probes (two ECU folders with identical AR paths and the same module definition;
boolean `1`; float `INF`; a required parameter carrying a `DEFAULT-VALUE`) reproduce the same classes
without customer data.

## Requirements

- **R1 — Copy-aware resolution.** A reference that resolves to a path declared in several files must
  resolve to the copy in the referencing file when the candidates are copies of one identity (same
  element `kind` and same `DEFINITION-REF`). Rules:
  - exactly one candidate → resolved;
  - several candidates, not copies → ambiguous;
  - several copies and exactly one in the referencing file → resolved to that copy;
  - several copies, none in the referencing file → **validation treats the reference as resolved**,
    but **navigation returns every copy** (Go to Definition returns multiple locations; the editor's
    "Jump to target" shows a quick pick). No silent first-file pick for navigation;
  - more than one copy in the referencing file → ambiguous (genuine same-file duplicates).

  `definitionEntry` keeps refusing any duplicate definition path; the copy rule does not apply to
  definition bodies.
- **R2 — Checked reference targets.** Only `DEST`s the index models with a path are checked:
  `ECUC-MODULE-CONFIGURATION-VALUES` and `ECUC-CONTAINER-VALUE`. A missing `DEST` keeps today's
  behaviour (validate against any ECUC value path). Parameter-value `DEST`s
  (`ECUC-NUMERICAL-PARAM-VALUE`, `ECUC-TEXTUAL-PARAM-VALUE`, `ECUC-REFERENCE-VALUE`,
  `ECUC-INSTANCE-REFERENCE-VALUE`) are skipped and documented: the index gives parameters no AR path,
  so they can never resolve. Non-ECUC `DEST`s produce no diagnostic.
- **R3 — Duplicate reporting.** One `duplicateShortName` diagnostic per duplicated AR path, at the
  first declaration, with `relatedInformation` pointing at the other declarations. Same-file duplicates
  keep the configured severity. Cross-file duplicates default to `information` and are still
  suppressed when the rule is `off`.
- **R4 — Multiplicity scope.** Multiplicity counts elements within one file and one owning parent; it
  must not sum copies that live in different files. The diagnostic text states the counting scope so a
  reader does not assume a workspace-wide count.
- **R5 — Documentation parameters.** `ECUC-ADD-INFO-PARAM-DEF` children are never reported as missing
  required parameters.
- **R6 — Value semantics.** An empty or whitespace-only `<VALUE>` means "use the default" and is not a
  type error. Boolean parameters accept `true`, `false`, `0`, `1` (trimmed, case-insensitive). Float
  parameters accept `INF`, `-INF` and `NaN` in addition to finite numbers. Integer, string-length and
  enumeration checks stay.
- **R7 — Missing definitions at the highest missing ancestor.** Collect every missing definition path,
  then report once at the highest missing ancestor of each missing chain. If the module definition is
  missing, one diagnostic for the module (with the occurrence count of all affected instances), not one
  per child. If the module definition is present and a child definition is missing, report that child.
  The v0.6 "root package has no indexed definitions" heuristic is dropped: it fails when definitions
  share a root such as `/AUTOSAR/EcucDefs/<Module>`.
- **R8 — User-controlled scope.** `arxmlScope.index.exclude` (array of workspace-relative globs,
  default `[]`) is applied to discovery, the watcher, validation, navigation and diagnostics. An open
  document that matches an exclusion gets no index-backed text-editor features (outline from the index,
  definition, references, links, hover); plain text editing is unaffected. The glob implementation is
  chosen deliberately and justified in `design.md`.
- **R9 — Default-value required parameters.** A required child whose definition declares a
  `DEFAULT-VALUE` is not reported as missing. This is the conservative reading pending AUTOSAR
  specification confirmation; the open decision is recorded in the PRD notes and must be answered
  before release.
- **R10 — Performance guards.**
  - Add a `validateWorkspace` benchmark (time and retained heap) over a large synthetic workspace
    (tens of MB, many files) to `npm run benchmark`, with an explicit budget.
  - Bound the validation pass instead of running an unbounded full sweep on every index change. The
    plan is a debounced, generation-guarded pass plus a per-file scope option; the chosen shape and
    budget are specified in `design.md`.
  - Debounce and size-limit the text-editor scans in `src/host/textFeatures.ts`, reusing
    `arxmlScope.index.maxFileSizeMB`. A document above the limit returns no index-backed features and
    does not rescan on every keystroke version.
- **R11 — Diagnostic volume guard.** Cap the diagnostics published to the Problems panel (per file and
  total, setting-controlled) and publish one additional summary diagnostic per affected file stating
  how many were hidden. Defaults are recorded in `design.md` and are an open decision.
- **R12 — Ambiguous definition path in Details.** When a `DEFINITION-REF` path matches several
  definitions, the Details panel shows `N definitions found` (N ≥ 2) instead of silently showing
  nothing. The editor still does not pick one definition.

## Non-goals

- Indexing non-ECUC AUTOSAR elements (`SW-ADDR-METHOD`, `IMPLEMENTATION-DATA-TYPE`, …).
- Auto-detecting "generated" files by name or content.
- Persisting the index or any parse cache to disk.
- Changing edit/write behaviour.
- Semantic rename matching in the diff (separate task `11-04-diff-semantic-rename-matching`).

## Acceptance criteria

- [ ] **R1** Synthetic fixture: a path duplicated across two files resolves a reference in each file to
      its own copy; a reference in a third file with no local candidate is resolved for validation but
      navigation returns every copy; two copies in the referencing file stay ambiguous; candidates that
      differ in `DEFINITION-REF` stay ambiguous.
- [ ] **R2** `DEST="SW-ADDR-METHOD"`, `DEST="IMPLEMENTATION-DATA-TYPE"` and parameter-value `DEST`s
      produce no `brokenReference`; a missing `DEST` still validates; `DEST="ECUC-CONTAINER-VALUE"`
      still reports a genuinely absent target.
- [ ] **R3** A path duplicated across two files produces exactly one `duplicateShortName` with
      `relatedInformation` entries for the other declarations; a same-file duplicate produces one
      diagnostic with the configured severity; setting the rule to `off` hides both.
- [ ] **R4** Two copies of the same container in different files produce no `multiplicity` diagnostic;
      a real over-occurrence inside one file still does, and its message names the per-file scope.
- [ ] **R5** A required `ECUC-ADD-INFO-PARAM-DEF` child that is absent produces no `missingRequired`.
- [ ] **R6** Empty and whitespace integer/float/enum values, `0`/`1` booleans, and `INF`, `-INF`,
      `NaN` floats produce no `valueOutOfRange`.
- [ ] **R7** A missing module definition produces one diagnostic at the module with the occurrence
      count; a missing child under a present module definition produces one diagnostic at the child;
      no diagnostic is produced per affected child instance.
- [ ] **R8** `arxmlScope.index.exclude` removes matching files from discovery, the watcher, validation,
      navigation and diagnostics; an open excluded document exposes no index-backed text features.
- [ ] **R9** A required parameter whose definition declares a `DEFAULT-VALUE` produces no
      `missingRequired`; a required parameter with no default still does.
- [ ] **R10** `npm run benchmark` reports `validateWorkspace` time and heap on the synthetic large
      workspace and fails when the budget is exceeded; the host does not run the validation sweep more
      often than the debounce/generation guard allows; a document above the size limit is not rescanned.
- [ ] **R11** A workspace producing more diagnostics than the cap publishes at most the cap plus one
      summary diagnostic per affected file, and the summary states the hidden count.
- [ ] **R12** A `DEFINITION-REF` matching two definitions renders `2 definitions found` in Details and
      still resolves to no single definition.
- [ ] **Reference project** Re-running the measurement on the 1,594-file project with
      `**/_fwd/**`, `**/_out/**`, `**/_gen/**` excluded yields at most 5,000 diagnostics and no
      diagnostic from the false-positive classes above. Validation time and heap are recorded before
      and after the change in the task notes and the PR body.
- [ ] **Multi-ECU fixture** Two synthetic ECU folders with identical AR paths and the same module
      definition produce no error-severity diagnostics and no `multiplicity` warning.
- [ ] `npm run check-types`, `npm run lint`, `npm test`, `npm run benchmark` and
      `npx @vscode/vsce ls` pass; the package lists only the intended files.
- [ ] Every new test fails when the code branch it covers is removed (mutation check).

## Notes

- Reference project: `D:\workspace\01_VW_ComVeh\00_BC_ComVeh\00_ScoutREX\DMG1311VX1A2848_M29A30_COM1015_1_0_ST528`
  (never commit its content; measurements only).
- The project's boolean parameters are written as `0`/`1` by its generator, so the strict form alone is
  not usable.
- Open decisions requiring a human answer before release: R9 skip vs lower severity, R3 cross-file
  duplicate severity, R8 glob implementation, R8 open-document features, R11 cap defaults and
  configurability, R10 validation-pass shape.
