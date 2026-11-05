# Remove validation false positives for split containers, variants, auto-assigned parameters

## Goal

ECUC validation no longer reports split (merged) container copies as duplicate names,
variant-alternative declarations as multiplicity violations, auto-assigned (`WITH-AUTO`)
parameters as missing, or same-identity local merge copies as ambiguous references.

The fixed workspace is measured against a real multi-file ECUC project. That measurement is
evidence only; the acceptance criteria below run on synthetic fixtures and must pass on a
machine that has no `ecu.worx`, no `C:\toolbase` pools, and no reference project.

## Background

A reference project (1,234 indexed files, 112,416 elements, excluding `**/_fwd/**`,
`**/_out/**`, `**/_gen/**`) produced 4,290 diagnostics with v0.7.0. Classification:

| Rule | Count | False positives | Cause |
|---|---|---|---|
| `duplicateShortName` | 3,063 | 3,010 | AUTOSAR split files repeat one container over several files, each copy holding a different subset of children. The copies are merged by consumers, so they are not duplicates. 53 groups are byte-identical copies and stay reported. |
| `multiplicity` | 233 | 116 | Sibling values guarded by different `VARIATION-POINT/SW-SYSCOND` conditions (e.g. `BswMLinTPEnabled` `(X==2)` and `(X!=2)`) are alternatives, not repetitions. |
| `missingRequired` | 888 | 134 | The required child definition carries `<WITH-AUTO>true</WITH-AUTO>`; the ECU configuration tool assigns it, so its absence is not a defect. |
| `brokenReference` | 92 | 4 | A target declared twice in the *same* file with the *same* definition is one merged element with two local copies; resolution refused it as ambiguous. |

The other 41 `brokenReference` diagnostics are same-path, different-definition collisions in one
file. They are a genuine authoring defect and stay reported. The remaining 754 `missingRequired`
hits have no `WITH-AUTO` marker; the dominant case is netmatrix stubs with no parameter values at
all and stays reported (the user can turn the rule off).

## Requirements

### R1 — Split-copy duplicates are suppressed, identical copies stay reported

`duplicateShortName` keeps reporting two cases:

- copies whose structural content is identical (byte-identical after whitespace and `UUID`
  normalization), and
- copies that declare the same path with different definitions or element kinds.

It suppresses a cross-file group when **all** copies share one identity (`kind` + `definitionRef`)
and their structural contents differ. Suppression is limited to cross-file groups; a same-file
group of different-content copies is still reported.

A variant-alternative group is suppressed when every copy carries a distinct `SW-SYSCOND`, even
if the contents are identical.

### R2 — Variant alternatives do not violate multiplicity

The multiplicity rule counts occurrences per owning parent **and** per `SW-SYSCOND` guard for the
upper bound, while the lower bound is still evaluated against the total. Two values that are
mutually exclusive by condition therefore satisfy `upper = 1` each, and a genuinely repeated
unguarded value still violates it.

### R3 — `WITH-AUTO` parameters are not reported missing

The definition index records the `<WITH-AUTO>` boolean for every definition element. The
`missingRequired` rule skips a required child whose definition has `withAuto === true`. A
required child without the marker is still reported.

### R4 — Same-identity local merge copies resolve

Reference resolution keeps refusing different-identity candidates (different `kind` or
`definitionRef`). When every candidate shares one identity and several copies sit in the
referencing file, resolution succeeds on the earliest local copy and returns all local copies
followed by the other copies. This is the only resolution behavior change.

### R5 — No new settings, dependencies, files or persisted state

The rules keep their names and severity settings. No new configuration key. No new runtime
dependency. The index stays in memory.

## Non-goals

- `POST-BUILD-VARIANT-VALUE` parameters (447 of the remaining 754 `missingRequired` hits) are
  **not** treated as optional in this change. Different AUTOSAR semantics; decide separately.
- No attempt to suppress the 41 same-path different-definition collisions; they are real.
- No change to `brokenReference` for genuinely absent targets, `destMismatch`,
  `valueOutOfRange` or `missingDefinition`.
- No webview, host service or settings UI change.
- No persisted cache or index.

## Constraints

- `src/core/**` stays dependency-free and must not import `vscode`.
- Only additive optional fields in the index model, so existing hand-built index fixtures keep
  compiling.
- Hashing must ignore whitespace differences (files in one project use different indentation) and
  must ignore `UUID`, otherwise split copies can never compare equal and identical copies can
  never compare equal across files.
- Peak memory stays proportional to nesting depth plus emitted records, as documented in
  `indexBuilder.ts`.
- Diagnostic messages stay understandable without knowing the implementation.

## Acceptance Criteria

All fixtures are synthetic and inline or under `src/test/fixtures/`. Each test must fail when its
branch is deleted (see `.trellis/spec/frontend/testing.md`).

- [ ] **AC1** Two files declare the same module path and the same container path with one
      definition but different child parameters: no `duplicateShortName` for that path.
- [ ] **AC2** The same fixture with identical child bytes in both files: exactly one
      `duplicateShortName` for that path.
- [ ] **AC3** One file declares the same container path twice with the same definition and
      different children: `duplicateShortName` is still reported (same-file group).
- [ ] **AC4** One file declares the same container path twice with different `DEFINITION-REF`s:
      `duplicateShortName` is still reported (identity collision).
- [ ] **AC5** One file declares two occurrences of a container whose definition allows
      `UPPER-MULTIPLICITY 1`, each guarded by a different `SW-SYSCOND`: no `multiplicity`.
- [ ] **AC6** The same two occurrences with the same guard (or no guard): `multiplicity` is
      reported.
- [ ] **AC7** A definition with `<WITH-AUTO>true</WITH-AUTO>` and `LOWER-MULTIPLICITY 1` is
      absent from the values: no `missingRequired`, and the parsed definition has
      `withAuto === true`.
- [ ] **AC8** The same definition without `WITH-AUTO` (or `false`): `missingRequired` is reported.
- [ ] **AC9** Two same-file copies of one path with the same definition resolve successfully;
      `copies` contains both, `element` is the earliest by offset.
- [ ] **AC10** Two same-file copies of one path with different definitions still resolve to
      `ambiguous` (existing assertion, kept).
- [ ] **AC11** The existing duplicate test that repeats one literal document in two files still
      reports one `duplicateShortName` (identical content stays reported).
- [ ] **AC12** `npm run check-types`, `npm run lint`, the offline core mocha suites and
      `npm run benchmark` pass. `npx @vscode/vsce ls` lists the package contents without error.

## Notes

- Expected post-fix totals on the reference project: ~1,025 diagnostics (from 4,290), with
  `duplicateShortName` 3,063 → 53, `multiplicity` 233 → 117, `missingRequired` 888 → 754,
  `brokenReference` 92 → 88. This is a sanity signal, not a gate: the reference project is not
  portable and is never committed.
- `prd.md` stays requirement-only. Implementation detail lives in `design.md` and `implement.md`.
