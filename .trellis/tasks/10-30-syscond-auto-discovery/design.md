# Auto-discover SW-SYSCOND constants — technical design

## 1. Data flow

```
scanEcucValues
  └─ buildRows
       └─ ownCondition(node): evaluateSyscond(...).symbols
            └─ EcucRow.condition.symbols
                 └─ page: discoveredSymbols()       (unique, document order)
                      └─ ensureDiscoveredConditionRows()
                           └─ Conditions table rows with value = ''
                                └─ empty value => unknown => values map excludes it
```

The page already receives every row on open and on every document change, so discovery needs no
new host scan, message, file read or parser. `result.symbols` is the evaluator's own identifier
list; it is never re-derived with a regex.

## 2. Row contract

`RowCondition` gains:

```ts
/** Identifiers referenced by this condition, in source order (from evaluateSyscond). */
symbols: string[];
```

`ownCondition` copies `result.symbols`. This is row data, not a new source position, and the diff
ignores it (the diff compares condition text only).

## 3. Empty value = unknown

`parseConditionEntries` keeps an entry with an empty value in `entries` (so the table and stored
list can represent it) but does **not** put it in `values`:

```ts
if (value === '') {
  values.delete(name);      // a later empty duplicate clears the earlier value
} else {
  values.set(name, parseConditionValue(value));
}
```

Consequences:

- A condition referencing the name sees it as missing → `unknown`.
- `unknown` never disables a row, so discovery cannot change the tree on first open.
- The host still sends the entry to the page, so the row remains visible with its empty input.
- On `load`, an old stored empty entry is normalized the same way; no migration is needed.

## 4. Page behavior

### 4.1 Discovery

```js
function discoveredSymbols() {
  // rows is the full DFS row store, not the visible window.
  // Unique, first appearance wins, blank/non-string ignored.
}

function existingConditionNames() {
  // read .condition-name inputs, trimmed, case-sensitive
}

function ensureDiscoveredConditionRows() {
  // append conditionRowElement({ name, value: '' }) for each missing symbol
  // never touches an existing input, value or order
  // updateConditionsChrome(); refresh unknown badges
}
```

Call sites:
- `setRows(...)` after `rows = incoming` and `indexRows()`: a document change, a reopen and the
  initial boot all pass through here.
- `renderConditionEntries(...)` after rebuilding from a host `conditions` message: a reload can
  otherwise lose the discovered rows.
- `ensureDiscoveredConditionRows` is idempotent; it must not call `sendConditions()` because
  discovery changes no value.

### 4.2 Unknown badge

Each row gets a `span.condition-state` after the value input:

```html
<span class="condition-state" hidden?>unknown</span>
```

`updateConditionRowState(row)` hides it when `value.trim() !== ''` and shows it otherwise. It is
called:
- when the row is built (stored values start correct);
- on every `.condition-value` input;
- when **Clear values** empties the row.

The badge uses `--vscode-descriptionForeground` with a dashed border; it is not a disabled state
for the row, just an input-completeness marker.

### 4.3 Clear values

`#conditions-clear` becomes **Clear values** (`title="Remove every entered value"`). It iterates
the rows, empties each `.condition-value`, refreshes each state badge, updates the chrome and sends
the entries. It no longer removes rows. `removeConditionRow` remains the per-row removal path.

### 4.4 Header chrome

`updateConditionsChrome` counts rows and missing values:

```
12 constants · 3 missing
```

The disabled-row count remains a separate span. The empty state only appears when there are zero
rows (a document with no `SW-SYSCOND`).

## 5. Interaction with existing behavior

- **Drafts:** the panel is outside `#tree`; `setRows` only appends missing rows, so a draft or
  focused input is untouched.
- **Removal:** removing a discovered row is local until the next `setRows`/host entries refresh;
  discovery can then add it again (PRD R6).
- **Filter/collapse:** discovery reads all rows, not the visible window, so a filtered-out condition
  is still listed.
- **Diff:** `diffModel` compares condition text, not symbols; no diff change.
- **Persistence:** discovered names are not persisted. Values typed into them are sent through the
  existing `conditions` message and stored in `workspaceState`. An empty entry may be stored too;
  `parseConditionEntries` keeps it visible but unknown.
- **Full-path aliases:** discovery uses the identifier text the scanner produced (normally a tail).
  A value stored under a full path still resolves through the evaluator's unique-tail fallback, but
  the panel lists the tail row separately. This is a display limitation, not an evaluation defect.

## 6. Tests

- `src/test/core/syscond.test.ts` already owns `symbols`; keep the source-order assertion.
- `src/test/editor/conditions.test.ts` asserts `row.condition.symbols` for a condition with two
  identifiers and for a literal-only condition (empty symbols).
- `src/test/editor/conditionValues.test.ts`:
  - an empty value keeps the entry but leaves `values` without the key;
  - a later empty duplicate clears an earlier value;
  - a later non-empty duplicate restores it.
- `src/test/editor/uxConditions.test.ts`:
  - `ensureDiscoveredConditionRows` appends only missing names, preserves an existing value and
    does not send a message;
  - the page uses `row.condition.symbols` from the row store;
  - the unknown badge shows for empty and hides for a typed value;
  - Clear values empties rows without removing them;
  - the header shows constants and missing counts;
  - a removed row is not re-added until `setRows` runs again.

## 7. Trade-offs

- **Page-side discovery** avoids duplicating the scanner in the host and keeps drafts stable, at the
  cost of the page knowing about `condition.symbols`.
- **Document order** is predictable and mirrors the file; alphabetical sorting is deferred.
- **Temporary removal** keeps the implementation small; a dismissed set would need its own
  workspace state and is not required for the first version.
- **Empty entries may be persisted** as part of the existing store. They are harmless and keep the
  table stable; the authoritative list is still regenerated from the document.
