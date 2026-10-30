# Auto-discover SW-SYSCOND constants — implementation plan

## Ordered checklist

### 1. Row data

- [ ] Add `symbols: string[]` to `RowCondition` in `src/editor/renderRows.ts`.
- [ ] Copy `result.symbols` in `ownCondition`.
- [ ] Add row tests for a two-symbol condition and a literal-only condition.
- [ ] Confirm the diff still compares only condition text (no diff change).

### 2. Empty value is unknown

- [ ] In `src/editor/conditionValues.ts`, keep empty entries in `entries` but delete the name from
  `values`; a later empty duplicate must clear an earlier value, and a later value must restore it.
- [ ] Add unit tests for empty-only, value→empty, and empty→value.
- [ ] Check the page/row condition state: a stored empty entry leaves the condition `unknown` and
  never disables a row.

### 3. Page discovery

- [ ] Add `discoveredSymbols()`, `existingConditionNames()` and
  `ensureDiscoveredConditionRows()` to the page script in `src/editor/renderHtml.ts`.
- [ ] Call discovery from `setRows` after `indexRows()` and from `renderConditionEntries` after the
  host entries are rebuilt.
- [ ] Do not send a conditions message from discovery.
- [ ] Keep `condition-row` names case-sensitive and unique by trimmed value.

### 4. Unknown badge and Clear values

- [ ] Add `span.condition-state` to `conditionRowElement`; show `unknown` initially when the value
  is empty.
- [ ] Add `updateConditionRowState(row)` / `updateConditionRowStates()` and call them on value input,
  on discovery and after Clear values.
- [ ] Rename `#conditions-clear` to **Clear values**; change `clearConditionEntries` to empty every
  value and keep the rows; update `title`/`aria-label`.
- [ ] Keep `removeConditionRow` as the per-row removal path.
- [ ] Update `updateConditionsChrome` to `N constants · M missing` and keep the disabled count
  separate.
- [ ] Add theme-only CSS for `.condition-state` and ensure it has no hard-coded colour.

### 5. Tests

- [ ] Extend `src/test/editor/uxConditions.test.ts`:
  - discovery appends missing names from `row.condition.symbols`;
  - existing typed values/drafts survive discovery;
  - discovery sends no message;
  - badge toggles with empty/typed values;
  - Clear values empties without removing;
  - header counts;
  - a removed row returns only after the next `setRows`.
- [ ] Extend the fixture-driven tests so `syscond.arxml` yields the expected discovered names.
- [ ] Add a test that a literal-only condition contributes no symbol.

### 6. Gates and manual check

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run package`
- [ ] In the Extension Development Host: open `syscond.arxml`, confirm the discovered rows and
  unknown badges, type `CANIPCORETYPE_SC=1`, confirm the conditioned row dims and the badge hides,
  click **Clear values**, confirm the list stays and the badges return.

## Risky files

- `src/editor/renderRows.ts` — adding `symbols` must not change row ids, ordering or condition
  states.
- `src/editor/renderHtml.ts` — discovery must not clobber an input draft or call `sendConditions`.
- `src/editor/conditionValues.ts` — empty-value semantics affect evaluation; update the tests before
  trusting the UI.

## Rollback

Remove `symbols` from `RowCondition`, delete the page discovery functions and calls, revert
`parseConditionEntries`'s empty-value branch, restore the Clear all behavior and remove the badge.
The evaluator, tree, diff and store remain usable throughout.
