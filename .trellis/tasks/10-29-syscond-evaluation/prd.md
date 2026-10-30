# SW-SYSCOND evaluation and disabled rows

## Goal

Let the user enter SW system-constant values manually (for example `CANIPCORETYPE_SC=1`) and have
the ECUC editor show which configuration rows are disabled by their `SW-SYSCOND` condition. A row
whose own condition evaluates false is dimmed; if the row is a container, its whole subtree is
dimmed too. Unresolved conditions are reported but never dim a row.

## Confirmed facts

- The scanner already captures `SW-SYSCOND` text on modules, containers, parameters and references
  (`src/core/ecuc/model.ts:16`). Inline `SYSC-REF` elements are replaced by their path tail, so
  `(… <SYSC-REF>CANIPCORETYPE_SC</SYSC-REF> == 0)` reads `(CANIPCORETYPE_SC==0)`
  (`src/core/ecuc/scanner.ts:123`; covered by `src/test/core/scanner.test.ts:29`).
- `renderRows` already renders the condition as a `[condition]` meta chip
  (`src/editor/renderRows.ts:399`), but nothing evaluates it.
- Rows are built by `buildRows(model, options)` and carry `id`, `parentId`, `level`,
  `subtreeSize`, `meta`, etc. (`src/editor/renderRows.ts:45`).
- The editor page has a toolbar, a filter, a details inspector and a `model` re-scan push
  (`src/editor/ecucEditorProvider.ts:129`).
- The provider has no extension context today; `extension.ts` constructs it without arguments.
- `workspaceState` is the appropriate per-workspace store; no file beside the user's ARXML may be
  written (quality guidelines).
- The user explicitly asked for manual values for now, and for the condition to apply to the node
  that owns it (container or parameter).

## Requirements

### Value entry

- **R1** Add a "Conditions" toggle to the ECUC editor toolbar. It opens a panel with a list of
  `name = value` rows, an "Add value" button, a per-row remove button, and "Clear all".
- **R2** A row has a constant-name input and a value input. Values accept:
  - integers and floats, including `0x` hexadecimal;
  - `true` / `false` (case-insensitive);
  - single- or double-quoted strings;
  - unquoted strings as a fallback.
- **R3** Names are trimmed; blank names are ignored. Operators allow letters, digits, `_`, `.`, `-`
  and `/` so a full `SYSC-REF` path can be pasted. Duplicate names: the last entry wins.
- **R4** Values are persisted per workspace in `workspaceState` and restored when the editor opens
  again. They are never written to the ARXML or to a file in the workspace.
- **R5** Editing, adding or removing a value re-evaluates immediately (debounced while typing) and
  updates row states without reloading the editor; filter, collapse and selection state survive.
- **R6** The panel shows a live count of disabled rows when greater than zero. Invalid names are
  marked `aria-invalid` and not sent; the host validates again and ignores bad entries.

### Evaluation

- **R7** Support the AUTOSAR condition expression subset:
  - literals: numbers (decimal/hex/float), `true`, `false`, quoted strings;
  - identifiers (system-constant names);
  - comparison: `==`, `!=`, `<`, `<=`, `>`, `>=`;
  - logic: `!`, `&&`, `||` with the usual precedence (`||` < `&&` < comparison < `!` < primary);
  - parentheses.
- **R8** Evaluation is three-valued: `true`, `false`, `unknown`.
  - An identifier with no supplied value is `unknown` and is reported as missing.
  - A syntax error makes the expression `unknown` with a reason.
  - `false && unknown` is `false`; `true || unknown` is `true`; otherwise an unknown operand makes
    the result unknown.
  - `==` / `!=` compare numbers numerically, booleans as booleans, strings as strings. Mixed
    types are `unknown` (do not silently disable).
  - Relational operators require numbers; anything else is `unknown` with a reason.
- **R9** Identifier lookup is exact first, then by the last `/` segment, so a value entered as
  `CANIPCORETYPE_SC` matches a condition whose text uses the same tail, and a pasted full path
  works too.
- **R10** Only nodes with their **own** `syscond` are evaluated:
  - A parameter/reference whose condition is false is disabled on its own.
  - A container/module whose condition is false is disabled together with its entire subtree.
  - A child with a true condition inside a false container remains disabled (ancestor wins).
  - An unknown condition never disables anything.
  - A condition with no supplied values but no symbols (a literal, e.g. `(1==0)`) still evaluates
    normally.
- **R11** The result is visible in three places:
  - the condition meta chip gets a state (`true` / `false` / `unknown`) with a tooltip reason;
  - a false row and its disabled descendants are dimmed; the row keeps its normal selection and
    reveal behaviour, and a visually hidden "(disabled by condition)" suffix is exposed to screen
    readers;
  - the details inspector shows the condition text, its state and the reason (missing constants or
    syntax error).
- **R12** With no stored values, symbolic conditions are `unknown` and the tree looks exactly as it
  does today. Only a literal false condition disables a row.

## Acceptance criteria

- [ ] **AC1** With `CANIPCORETYPE_SC=1`, a parameter whose condition is
  `[(CANIPCORETYPE_SC==0)]` is dimmed and its condition chip reads `false`; with `0` it is not
  dimmed and reads `true`.
- [ ] **AC2** A container with a false condition dims itself and every descendant, including
  descendants with no condition and descendants with a true condition.
- [ ] **AC3** A parameter with a false condition dims only that parameter; sibling parameters and
  the parent container stay normal.
- [ ] **AC4** A missing constant (`A==1` with no `A`) yields `unknown`, reports `A` as missing, and
  dims nothing.
- [ ] **AC5** A malformed condition (`(A==`) yields `unknown` with a syntax reason and dims nothing.
- [ ] **AC6** `false && UNKNOWN` is false; `true || UNKNOWN` is true; precedence and parentheses
  match the grammar.
- [ ] **AC7** Numeric, hex, boolean and quoted-string comparisons evaluate as specified; a
  number-vs-string comparison is unknown.
- [ ] **AC8** Values survive closing and reopening the editor in the same workspace; values are not
  written to disk beside the ARXML.
- [ ] **AC9** Typing a value updates rows within the debounce without losing the filter, collapsed
  containers or selection; the disabled count updates.
- [ ] **AC10** The details inspector shows the condition text, state and reason for a node with a
  condition.
- [ ] **AC11** No values configured → no regression in the existing rendered tree (all existing
  tests pass).
- [ ] **AC12** The evaluator, row propagation, value parsing and store are unit-tested; the page
  boot gate still passes in `npm run package`.

## Out of scope

- Reading constants from `SwSystemconst` ARXML files or any other source.
- Editing `SW-SYSCOND` in the ARXML.
- Evaluating `POST-BUILD-VARIANT` / `VARIANT` conditions.
- Bitwise operators, functions, ternaries, regexes, or arithmetic (`+`, `-`, `*`, `/`) beyond
  numeric literal signs.
- Auto-deleting or hiding disabled configuration; dimming is a visual state only.
- Persisting values across workspaces or through Settings Sync.

## Dependencies

- None on the other children. This child is last because it touches the editor page, row builder and
  provider most deeply.
