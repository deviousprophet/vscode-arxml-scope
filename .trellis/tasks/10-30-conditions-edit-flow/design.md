# Conditions edit/save/cancel flow — technical design

## 0. Sidebar placement

The table is rendered inside the Conditions tab's **Condition values** section body
(`#sb-conditions-values-body`) created by `10-30-sidebar-shell-buttons`. This task does not create a
tab, section or top panel. The section header carries a badge with `N constants · M missing`; the
body owns the table and its footer.

Row actions use the shell's shared classes:

- Edit/Remove: `.act-btn` compact icon actions (pencil/trash) with accessible names.
- Save: `.sb-btn .sb-btn-primary`.
- Cancel: `.sb-btn .sb-btn-secondary`.
- Add value: `.sb-btn .sb-btn-add`.
- Clear values: `.sb-btn .sb-btn-secondary` with the danger hover treatment for its destructive
  intent.

## 1. Row contract

Each `.condition-row` carries its committed state as data, not as input values:

```html
<div class="condition-row" data-name="CANIPCORETYPE_SC" data-value="1"
     data-auto="true" data-editing="false">…</div>
```

- `data-name`: the scanned or saved constant name.
- `data-value`: the committed value; empty means unknown.
- `data-auto`: `"true"` when the name is referenced by the current document; scanned rows have no
  Remove action.
- `data-editing`: `"true"` while the row's draft is open.
- `data-new`: `"true"` for an Add draft that has not been saved (the row is removed by Cancel).

`readConditionEntries()` reads the committed `data-name`/`data-value` pairs, never the draft input.
This is the single reason a draft cannot leak into the host until Save.

## 2. Row rendering

`conditionRowElement(entry, options)` creates the row and calls `renderConditionRow(row)`.

### View mode

```
[name text] = [value text | unknown badge] [pencil Edit] [trash Remove?]
```

- Name is a `.condition-name-text` span; it is never an input after Save.
- A non-empty committed value is `.condition-value-text`.
- An empty committed value is `.condition-state` with `unknown` (badge visible).
- Edit is an icon button `.condition-icon.condition-edit` with `title="Edit"` and
  `aria-label="Edit <name>"`.
- Remove is an icon button `.condition-icon.condition-remove` with
  `title="Remove"`/`aria-label="Remove <name>"`, rendered only when `data-auto !== 'true'`.

### Edit mode

```
[name text | name input (new only)] = [value input] [Save primary] [Cancel secondary]
```

- The name stays text for an existing row.
- A new manual row has a name input; both inputs are inside the row.
- Save is `.sb-btn .sb-btn-primary` with the text `Save`; Cancel is `.sb-btn .sb-btn-secondary` with
  `Cancel`. This mirrors Hex Scope's `sb-btn-primary` / `sb-btn-secondary` footer.
- Enter saves and Escape cancels; both stop propagation so the tree key handler never sees them.
- Starting Edit on another row calls `cancelConditionEdit(editingRow)` first, so only one draft
  exists.

## 3. State machine

```js
let editingRow = null;

function beginConditionEdit(row) {
  if (editingRow && editingRow !== row) cancelConditionEdit(editingRow);
  editingRow = row;
  row.dataset.editing = 'true';
  renderConditionRow(row);
  focus the value input (or the name input when data-new === 'true');
}

function saveConditionEdit(row) {
  const name = row.dataset.new === 'true' ? nameInput.value.trim() : row.dataset.name;
  validate name (non-empty, isConditionName, not a duplicate of another row);
  if invalid: status message; keep editing; return;
  row.dataset.name = name;
  row.dataset.value = valueInput.value;
  delete row.dataset.new;
  row.dataset.editing = 'false';
  editingRow = null;
  renderConditionRow(row);
  updateConditionsChrome();
  syncConditionRowAutoFlags();
  sendConditions();
}

function cancelConditionEdit(row) {
  if (row.dataset.new === 'true') {
    row.remove();
  } else {
    row.dataset.editing = 'false';
    renderConditionRow(row);
  }
  if (editingRow === row) editingRow = null;
  updateConditionsChrome();
}
```

- `renderConditionRow` clears the row and rebuilds it from the dataset/current mode. Model text is
  always `textContent`.
- Save with an empty value is allowed; it makes the row unknown again.
- Cancel never sends a message and never changes the committed value.

## 4. Auto vs manual

`discoveredConditionSymbols()` already returns the document's identifiers. Add:

```js
function syncConditionRowAutoFlags() {
  const discovered = new Set(discoveredConditionSymbols());
  for each `.condition-row`:
    const auto = discovered.has(row.dataset.name);
    row.dataset.auto = auto ? 'true' : 'false';
    update the Remove button's presence (view mode only; never rebuild an editing row);
}
```

- `ensureDiscoveredConditionRows` creates rows with `data-auto="true"`.
- `renderConditionEntries` creates rows from stored entries, then `syncConditionRowAutoFlags` marks
  any stored name that is also in the document as auto.
- A manual row whose name becomes referenced loses its Remove action on the next model re-scan and
  keeps its value.
- The old `conditionDiscovery.dismissed` set is removed: scanned rows can no longer be removed, so
  there is nothing to dismiss. Manual rows are removed explicitly.

## 5. Badge and counts

```js
function updateConditionRowState(row) {
  const state = row.querySelector('.condition-state');
  if (!state) return;
  const editing = row.dataset.editing === 'true';
  const value = (row.dataset.value || '').trim();
  state.hidden = editing || value !== '';
}
```

- Empty committed value → badge visible (the old code was inverted: `=== ''` hid it).
- Draft typing → no badge; the row is in edit mode.
- Save with a value → badge hidden; Save with empty or Cancel → badge visible.
- `updateConditionsChrome` counts `data-value`, not input drafts:
  `count` = rows, `missing` = rows with `data-value.trim() === ''`.
- `Clear values` first cancels any active edit, sets every `data-value = ''`, re-renders the rows in
  view mode, updates chrome and sends one message.

## 6. Add value

`addConditionEntry` appends a row with `data-new="true"`, `data-auto="false"`, empty name/value and
starts edit mode. Save validates the name:
- blank → status message;
- invalid pattern → status message;
- duplicate of another row's `data-name` → status message;
- valid → commit, clear `data-new`, send.
Cancel removes the unsaved row and updates chrome.

## 7. Messaging

- Remove `conditionDebouncer` and `scheduleConditions` for values. `sendConditions()` remains and is
  called only by Save, Remove, Clear values and a valid Add save.
- The host contract (`{ type: 'conditions', entries }`) and `workspaceState` key are unchanged.
- The provider still re-pushes rows on a conditions message; because drafts are local and rows are
  keyed by committed data, that push cannot overwrite an edit draft.

## 8. Tests

- Badge: empty visible, non-empty hidden, editing hidden; Save/Cancel transitions.
- Auto/manual: scanned row has no Remove, manual row has it; a manual name becoming discovered loses
  Remove and keeps its value.
- One edit: starting a second Edit cancels the first and restores its value.
- Save: commits dataset, one message, badge/count update, exits edit.
- Cancel: restores or removes a new row, sends nothing.
- Add: invalid/duplicate name rejected, valid save adds one row, Cancel removes it.
- Read: `readConditionEntries` ignores a draft and reads committed data.
- Clear values: cancels edit, empties committed values, keeps rows, one message.
- Badge regression: the old inverted predicate (`=== ''`) fails the empty/non-empty tests.
- Existing page tests for discovery, provider wiring, evaluator and tree remain green.

## 9. Trade-offs

- **Explicit Save** removes live typing and the debounce, but gives a clear draft boundary and
  matches the requested Hex Scope pattern.
- **Scanned names are immutable** because the document owns them; manual entries are the only
  removable rows.
- **Dataset as the committed state** keeps the host message bounded and makes a draft impossible to
  send accidentally.
- **One draft at a time** avoids merging two independent messages and keeps the UI predictable.
