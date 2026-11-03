# v0.6: ECUC validation

## Requirements

- **R1 — Rule engine.** A pure `validateWorkspace(index, options)` returns diagnostics for:
  broken reference, DEST mismatch, duplicate `SHORT-NAME`, value out of range, multiplicity
  violation, missing definition, missing required container/parameter.
- **R2 — Severity.** Each rule has `error`, `warning`, `information` or `off`. `off` removes it.
- **R3 — Diagnostics surface.** A `DiagnosticCollection` publishes the results to the Problems panel
  and the text editor, refreshed after every index change.
- **R4 — Settings.** `arxmlScope.validation.enabled` (default `true`) and
  `arxmlScope.validation.severities`, an object keyed by rule with the four severity values.
- **R5 — No false guesses.** An ambiguous path is `warning`/`error` as configured; resolution never
  picks one. A missing definition is reported only when the index has definitions (otherwise the
  absence is "no BSWMD loaded", not a defect).
- **R6 — Position data.** `FileIndex.lineStarts` lets the host convert offset ranges without reading
  the file again.

## Rule defaults

| Rule | Default | Meaning |
|---|---|---|
| `brokenReference` | error | no target, or target path absent/ambiguous |
| `destMismatch` | warning | target resolves to the wrong element kind |
| `duplicateShortName` | error | two elements share one AR path |
| `valueOutOfRange` | warning | integer/float outside limits or string outside length |
| `multiplicity` | warning | container/parameter/reference count outside declared bounds |
| `missingDefinition` | information | a `DEFINITION-REF` has no indexed definition |
| `missingRequired` | warning | a definition with lower multiplicity > 0 has no instance |

## Acceptance criteria

- One core test per rule, plus severity `off` and a clean file with no diagnostics.
- An extension test writes two temp files, reindexes, waits for the collection and asserts
  `vscode.languages.getDiagnostics` contains the expected code.
- Disabling validation clears the collection; re-enabling republishes.
- `npm run check-types`, `npm run lint` and `npm test` pass.
