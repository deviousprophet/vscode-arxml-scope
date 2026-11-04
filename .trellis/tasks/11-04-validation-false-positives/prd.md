# Fix ECUC validation false positives on duplicate and generated ARXML workspaces

## Goal

Make the v0.6 ECUC validation rules trustworthy on real automotive projects: the Problems panel must
show the user's real errors, not artifacts of generated copies, non-ECUC references or documentation
parameters. Navigation and text-editor features must use the same corrected resolution.

## Context

A run of v0.6.0 on a 1,594-file, 359 MB ECUC project produced 61,566 diagnostics, of which roughly
54,000 were false positives. Measurements and samples are in `research/validation-false-positives.md`.

## Requirements

- **R1 — Same-file resolution.** A reference that resolves to a path existing in several files must
  resolve to the copy in the referencing file when the candidates are copies of one identity (same
  element kind and same `DEFINITION-REF`). Genuinely different candidates stay ambiguous.
- **R2 — Non-ECUC targets.** A reference whose `DEST` is not an ECUC value kind must not be reported as
  broken; the index does not model those elements.
- **R3 — Duplicate reporting.** A duplicate AR path produces one diagnostic per path, not one per
  element. Same-file duplicates keep the rule's severity; cross-file duplicates are informational.
- **R4 — Multiplicity scope.** Multiplicity counts elements within one file and one owning parent; it
  must not sum copies that live in different files.
- **R5 — Documentation parameters.** `ECUC-ADD-INFO-PARAM-DEF` children are never reported as missing
  required parameters.
- **R6 — Value semantics.** An empty `<VALUE>` means "use the default" and is not a type error. Boolean
  parameters accept `true`/`false` and `0`/`1`.
- **R7 — Missing definitions.** Report one diagnostic per missing definition path, and stay silent when
  the definition's root package contributes no definitions to the workspace at all.
- **R8 — User-controlled scope.** Add a setting that excludes glob paths (for example generated
  `_fwd`, `_out`, `_gen` trees) from indexing, validation, navigation and text features.

## Non-goals

- Indexing non-ECUC AUTOSAR elements (`SW-ADDR-METHOD`, `IMPLEMENTATION-DATA-TYPE`, …).
- Auto-detecting "generated" files by name or content.
- Persisting the index to disk.
- Changing edit/write behaviour.

## Acceptance criteria

- [ ] A synthetic fixture with a duplicated AR path across two files resolves a reference in each file
      to its own copy; a reference in a third file stays ambiguous when the two copies differ in
      `DEFINITION-REF`.
- [ ] A reference with `DEST="SW-ADDR-METHOD"` and one with `DEST="IMPLEMENTATION-DATA-TYPE"` produce no
      `brokenReference`.
- [ ] A path duplicated across two files produces exactly one `duplicateShortName`; a same-file duplicate
      produces one diagnostic with the configured severity.
- [ ] Two copies of the same container in different files produce no `multiplicity` diagnostic; a real
      over-occurrence inside one file still does.
- [ ] A required `ECUC-ADD-INFO-PARAM-DEF` child that is absent produces no `missingRequired`.
- [ ] Empty integer/float/enum values and `0`/`1` booleans produce no `valueOutOfRange`.
- [ ] A definition missing while its root package is indexed produces one diagnostic; a definition whose
      root package has no indexed definitions produces none.
- [ ] `arxmlScope.index.exclude` removes matching files from the index and from all features.
- [ ] Re-running the measurement on the reference project with `**/_fwd/**`, `**/_out/**`, `**/_gen/**`
      excluded yields at most 5,000 diagnostics and no diagnostic from the false-positive classes above.
- [ ] `npm run check-types`, `npm run lint`, `npm test`, `npm run benchmark` and
      `npx @vscode/vsce ls` pass; the package lists only the intended files.

## Notes

- Reference project: `D:\workspace\01_VW_ComVeh\00_BC_ComVeh\00_ScoutREX\DMG1311VX1A2848_M29A30_COM1015_1_0_ST528`
  (never commit its content; measurements only).
- The project's boolean parameters are written as `0`/`1` by its generator, so the strict form alone is
  not usable.
