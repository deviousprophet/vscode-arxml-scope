# Conditions table edit/save/cancel flow

## Goal

Make the Conditions table predictable: a scanned `SW-SYSCOND` constant is derived from the document, so it cannot be removed or renamed; editing its value is an explicit **Edit → Save / Cancel** action. The `unknown` badge must mean “no saved value”, so typing a value must not show it. Manually added rows remain removable.

This replaces the current live-typing/debounced save and the per-row Remove on scanned rows.

## Confirmed facts

- The current badge predicate is inverted: `state.hidden = value.value.trim() === ''` hides the badge for an empty value and shows it after typing. It must be `!== ''` (visible when empty).
- The current page sends a debounced `conditions` message on every input, so a draft is indistinguishable from a committed value and the host re-pushes rows mid-edit.
- The Conditions page currently renders rows from stored entries, adds discovered rows, and marks empty values as unknown in the host; the host semantics (empty value = unknown) stay.
- Hex Scope tags a per-row pencil `act-btn-edit` (title/aria `Edit`) and uses `sb-btn-primary` **Save** plus `sb-btn-secondary` **Cancel** in its editor footer (`overlayPanel.ts:733`, `:990`, `:3076`). The same visual hierarchy should apply here.
- `renderRows` already exposes `condition.symbols`, and the page discovers names from the full row store.
- The host stores only raw `{ name, value }` entries in `workspaceState`; no schema change is required.

## Requirements

### Badge

- **R1** The `unknown` badge is visible exactly when the row's **committed** value is empty and the row is not in edit mode.
- **R2** Typing in an edit draft never shows the badge; Save with a non-empty value hides it; Save with an empty value, Cancel after clearing, or Clear values restores it.
- **R3** The `N constants · M missing` count counts committed values, not drafts.

### Scanned vs manual rows

- **R4** A row whose name is referenced by any `SW-SYSCOND` in the current document is **scanned**:
  - the name is read-only;
  - there is no Remove/trash action;
  - only the value can be edited.
- **R5** A stored row whose name is not referenced by the document is **manual**:
  - the name is read-only after creation;
  - the value can be edited;
  - a Remove/trash action is available.
- **R6** A manual name that later appears in an `SW-SYSCOND` becomes scanned on the next model re-scan: Remove disappears, and the value is preserved.

### Edit / Save / Cancel

- **R7** Each row has an **Edit** pencil action. Clicking it enters edit mode for that row only.
- **R8** Edit mode replaces the value text with a value input and shows a primary **Save** and a secondary **Cancel** action. The name stays read-only for an existing row.
- **R9** At most one row edits at a time. Starting Edit on another row cancels the previous draft (restores its committed value) before opening the new one.
- **R10** Save commits the draft, sends one `conditions` message, updates the badge/counts and returns to view mode.
- **R11** Cancel discards the draft, restores the committed value, updates the badge and returns to view mode.
- **R12** Enter in the value input saves; Escape cancels.
- **R13** A manual row that was created by Add value but not saved is removed by Cancel.

### Add value

- **R14** **Add value** creates a manual row in edit mode with a name input and a value input, and focuses the name.
- **R15** Save validates the name (existing rule), rejects an empty name or a duplicate name already present in the table, and keeps edit mode with a status message on failure.
- **R16** A new manual row is added only on Save; Cancel removes it.

### Messaging and clearing

- **R17** The page sends `conditions` only on Save, Remove, Clear values and a valid Add save — not on every keystroke. The 300 ms value-typing debounce and its stale-payload race are removed.
- **R18** **Clear values** cancels any active edit, empties every committed value, keeps all rows, restores every badge and sends one message.
- **R19** Remove sends one message for a manual row and cannot target a scanned row (there is no control).

### Accessibility and safety

- **R20** Edit, Save, Cancel and Remove have accessible names, visible focus, and disabled/absent states that match their availability. The value input is labelled and owns Enter/Escape while editing.
- **R21** The row name and value are textContent, never markup; no hard-coded colour, inline style, dependency or file write is introduced.
- **R22** `Clear values`, discovery, empty-value evaluation and unknown-never-disables semantics stay unchanged except for the explicit edit flow.

## Acceptance criteria

- [ ] **AC1** A scanned row with no value shows `unknown`; typing `1` in edit mode does not show it; Save hides it; clearing and saving shows it again.
- [ ] **AC2** A scanned row has Edit but no Remove; a manual row has Edit and Remove.
- [ ] **AC3** Edit opens one row at a time; opening another cancels the first draft and restores its value.
- [ ] **AC4** Save commits one value, updates the badge/counts, exits edit mode and persists through `workspaceState`.
- [ ] **AC5** Cancel restores the previous value; for a newly added unsaved manual row it removes the row.
- [ ] **AC6** Add value opens a name+value draft; Save rejects empty/duplicate names; a valid Save adds the row; Cancel leaves no row.
- [ ] **AC7** Clear values cancels an active edit, empties all committed values, keeps the row list and restores every badge.
- [ ] **AC8** No `conditions` message is sent while typing a draft; exactly one is sent per Save/Remove/Clear/valid Add.
- [ ] **AC9** A manual name that later appears in the document loses its Remove action on the next re-scan and keeps its value.
- [ ] **AC10** All existing evaluator, row, Conditions, diff, menu, filter and editing tests pass; new tests cover the badge, auto/manual availability, one-edit rule, save/cancel and message count.
- [ ] **AC11** No file write, new dependency, hard-coded colour or duplicate action set.
- [ ] **AC12** The table is inside the Conditions tab/section with no toolbar Conditions button; its
  actions use the shared primary/secondary/add/danger/act-button classes.

### Sidebar integration

- **R23** The Conditions table lives in the **Conditions** sidebar tab created by
  `10-30-sidebar-shell-buttons`, inside the **Condition values** section body. There is no toolbar
  Conditions button or top-of-editor panel.
- **R24** Row actions use the shell's shared primitives: pencil **Edit** and trash **Remove** as
  compact `.act-btn` actions, primary **Save**, secondary **Cancel**, dashed-accent **Add value**,
  and a secondary **Clear values**.
- **R25** The section header shows the committed `N constants · M missing` state as a badge; the
  body owns the table and footer actions.
- **R26** Opening or switching to the Conditions tab does not change the filter, search, selection or
  tree state.

## Out of scope

- Editing or removing a scanned constant's name.
- Removing a scanned constant from the table.
- Live auto-save while typing.
- A confirmation dialog for Remove or Clear values.
- Changing the evaluator, the workspace-state key or the empty-value semantics.
- The planned Find bar (`10-30-find-bar-search`), which stays separate.

## Notes

- The row actions should follow Hex Scope's hierarchy: pencil Edit, primary Save, secondary Cancel, trash Remove.
- Real focus, keyboard and contrast behavior still need an Extension Development Host check.

## Dependencies

- `10-30-sidebar-shell-buttons` must land first: it provides the Conditions tab, the section body,
  and the shared button/field classes. This task owns only the table content and its edit state.
- No dependency on the Find task.
