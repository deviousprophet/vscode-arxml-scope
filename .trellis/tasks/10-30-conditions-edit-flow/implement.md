# Conditions edit/save/cancel flow — implementation plan

## Ordered checklist

### 1. Fix the badge predicate first

- [ ] Confirm `10-30-sidebar-shell-buttons` has landed (Conditions tab/section body and shared
  button classes exist).
- [ ] Change `updateConditionRowState`/initial row state to `hidden = editing || value.trim() !== ''`
  so an empty committed value is visible and a typed draft is never shown as unknown.
- [ ] Flip the existing badge test expectations; add a regression that the old inverted predicate
  fails.
- [ ] Make `updateConditionsChrome` count `data-value`, not input values.
- [ ] Move the count text into the section-header badge supplied by the shell.

### 2. Row data and view mode

- [ ] Add `data-name`, `data-value`, `data-auto`, `data-editing` and `data-new` to
  `conditionRowElement`.
- [ ] Render the view row: name text, `=`, value text or unknown badge, Edit pencil, and Remove only
  for manual rows.
- [ ] Use `.sb-btn .sb-btn-primary` for Save, `.sb-btn .sb-btn-secondary` for Cancel and Clear,
  `.sb-btn .sb-btn-add` for Add, and `.act-btn` for Edit/Remove.
- [ ] Update `readConditionEntries` to read committed datasets only.

### 3. Edit state machine

- [ ] Add `editingRow`, `beginConditionEdit`, `saveConditionEdit`, `cancelConditionEdit`.
- [ ] Only one draft at a time; opening another cancels the previous.
- [ ] Save validates the name for new rows, commits dataset, sends one message, re-renders view and
  updates chrome.
- [ ] Cancel restores the committed value or removes an unsaved new row; sends nothing.
- [ ] Enter saves, Escape cancels; stop propagation in the row inputs.

### 4. Auto/manual rules

- [ ] Add `syncConditionRowAutoFlags`; scanned rows get no Remove, manual rows do.
- [ ] Remove the old `conditionDiscovery.dismissed` logic; scanned rows can no longer be removed.
- [ ] `ensureDiscoveredConditionRows` creates auto rows and re-syncs flags.
- [ ] A manual name that becomes discovered loses Remove on the next `setRows` and keeps its value.

### 5. Add / Remove / Clear

- [ ] Add value creates a `data-new` manual row in edit mode with a name input; focus the name.
- [ ] Duplicate/blank/invalid names keep edit mode with a status message.
- [ ] Remove is available only on manual rows and sends one message.
- [ ] Clear values cancels the active edit, empties committed values, keeps rows, restores badges and
  sends one message.
- [ ] Remove `conditionDebouncer`/`scheduleConditions`; keep `sendConditions` for explicit commits.

### 6. Tests

- [ ] Badge: empty visible, non-empty hidden, editing hidden, Save/Cancel transitions.
- [ ] Auto/manual availability and the manual→auto transition.
- [ ] One edit at a time, Save one-message, Cancel no-message/no commit.
- [ ] Add validation and Cancel removal.
- [ ] `readConditionEntries` ignores a draft.
- [ ] Clear values behavior and counts.
- [ ] Existing discovery/provider/evaluator/tree tests remain green.

### 7. Gates and manual check

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run package`
- [ ] Extension Development Host: scanned row shows unknown, Edit → type `1` → Save hides unknown and
  dims the conditioned row; Edit → change → Cancel restores; scanned row has no trash; Add row can
  be removed; Clear values keeps rows.
- [ ] Confirm no file is written and no dependency is added.

## Risky files

- `src/editor/renderHtml.ts` — row rebuilds must not lose drafts or focus; discovery must not
  re-add a removed manual row.
- `src/editor/conditionValues.ts` — no change expected; empty-value semantics stay.
- `src/editor/ecucEditorProvider.ts` — no change expected; messages only become less frequent.
- `src/test/editor/uxConditions.test.ts` — the current tests encode the old live-typing and
  removal behavior; update them with the new state machine.

## Rollback

Restore the live-typing row builder and badge predicate, remove the edit state, restore per-row
Remove, and reinstate the dismissal set. The evaluator, storage and discovery data stay usable.
