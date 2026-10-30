# Auto-discover SW-SYSCOND constants

## Goal

When an ECUC document opens, the Conditions panel should already list every constant referenced by an `SW-SYSCOND` in that document. The rows start with **no value** and an explicit `unknown` state; the user only has to type the value. Conditions using an unknown constant stay unresolved and dim nothing.

## Confirmed facts

- `SW-SYSCOND` is captured on every module, container, parameter and reference (`src/core/ecuc/model.ts`).
- `evaluateSyscond(text, values)` already returns the identifiers referenced by an expression in `result.symbols`, plus `missing` and a three-valued state (`src/core/ecuc/syscond.ts`).
- `buildRows` evaluates each node's own condition and carries `RowCondition` on the row (`src/editor/renderRows.ts`).
- The Conditions panel renders only the entries supplied by the host and persisted in `workspaceState`; there is no discovery path today.
- `parseConditionEntries` currently treats an empty value as the known empty string, so an empty entry would not be `unknown`.
- The Conditions panel shell, Add/Clear actions and empty state were just made visible (archived task `10-30-conditions-panel-actions`).

## Requirements

- **R1** On open and after every document change, scan every `SW-SYSCOND` in the current model and collect the unique identifiers in first-appearance/document order.
- **R2** The Conditions table includes a row for each discovered identifier that is not already present in the stored entries. Discovered rows have an empty value.
- **R3** An empty value means **unknown**, not a known empty string:
  - it is excluded from the evaluation value map;
  - a condition using it stays `unknown`;
  - it never disables a row.
- **R4** Discovery never overwrites or reorders a user-entered value and never discards a draft in the panel.
- **R5** Each empty row displays an `unknown` badge. Typing a value hides the badge for that row; emptying the value restores it.
- **R6** Removing a discovered row is allowed. It stays removed until the next model re-scan (document change or reload), when discovery can add it again; this is documented behavior, not a bug.
- **R7** The destructive action becomes **Clear values**: it empties every row's value and restores every unknown badge, but keeps the discovered list visible. It is disabled when there are no rows.
- **R8** The panel header shows the number of constants and, when greater than zero, the number of missing values (for example `12 constants · 3 missing`).
- **R9** Values remain workspace state only. Discovery creates no file, no cache and no second parser.
- **R10** The evaluator remains the single owner of expression parsing; discovery reuses the symbols it already returns.

## Acceptance criteria

- [ ] **AC1** Opening a document with `(CANIPCORETYPE_SC==0)` and other conditions lists every referenced constant with an empty value and an `unknown` badge, without the user adding anything.
- [ ] **AC2** With all discovered values empty, no row is disabled and the tree looks as it does today.
- [ ] **AC3** Typing `CANIPCORETYPE_SC = 1` dims the row whose condition is `[(CANIPCORETYPE_SC==0)]` and hides that row's unknown badge; `0` restores it.
- [ ] **AC4** A typed value survives a document change, a re-scan and reopening the editor; discovery does not overwrite it.
- [ ] **AC5** **Clear values** empties every value, restores every badge and leaves the constant list in place.
- [ ] **AC6** The header count reflects all rows and the missing-value count.
- [ ] **AC7** A removed discovered row is not re-added by the next keystroke; it may return on the next document change.
- [ ] **AC8** Duplicate references to one constant produce one row; literals (`true`, numbers) produce none.
- [ ] **AC9** All existing evaluator, row, Conditions, diff, menu and filter tests pass, with new discovery assertions.
- [ ] **AC10** No file write, new dependency, hard-coded colour or second parser is introduced.

## Out of scope

- Reading constants from `SwSystemconst` files or any external source.
- Evaluating post-build variant conditions.
- Sorting or grouping the discovered list (document order for now).
- Persisting the discovered names themselves; they are regenerated from the document.
- Remembering removed discovered rows across reloads.
- A separate per-file condition store.

## Notes

- The panel is a webview surface; real rendering, badge contrast and input focus still need an Extension Development Host check.
- This task builds on the archived visibility task but is independently verifiable.
