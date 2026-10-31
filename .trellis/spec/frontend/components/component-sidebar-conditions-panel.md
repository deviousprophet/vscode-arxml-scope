# Component Spec — Sidebar Conditions Panel

> Built from `component-template.md`. Nested panel of the Sidebar component.

## Scope / Trigger

Owns `src/webview/components/sidebar/conditionsPanel/` (`conditionsPanel.ts`,
`conditionsPanel.css`): the SW-SYSCOND value list, discovered document-owned rows, the one editable
draft, the add/clear actions and the status line. The host owns workspace persistence.

## Layout

```text
src/webview/components/sidebar/conditionsPanel/
    conditionsPanel.ts   markup + validation + panel controller script
    conditionsPanel.css  panel styles
src/webview/editorViewer.ts         composition root (rows + persistence callback)
src/test/webview/components/conditionsPanel.test.ts
```

## Contract

```typescript
export function conditionNameValid(name: string): boolean;
export function conditionEntryError(name: string, others?: readonly string[]): string;
export function renderConditionsPanelHtml(): string;
export function setConditionRows(next: unknown): void;
export function setConditionsCallback(callback: (entries: ConditionEntry[]) => void): void;
export function setConditionsErrorReporter(reporter: (text: string) => void): void;
export function ensureDiscoveredConditionRows(): void;
export function renderConditionEntries(entries: unknown): void;
export function setConditionsStatus(message: string): void;
export function applyDisabledCount(): void;
export function applyConditionsMessage(message: unknown): boolean;
export function mountConditionsPanel(): void;
```

## Rules

- One draft at a time; starting another cancels the first and restores its committed value.
- Discovered rows (`data-auto="true"`) are document-owned: their value is editable, but they have no
  Remove action. Manual rows keep Edit and Remove.
- The committed `data-value` is the only value read; a draft input is never persisted.
- Clear empties values but keeps rows; Add creates an unsaved draft and sends nothing before Save.
- Entries are reported through `onConditionsChange`, never `vscode.postMessage`.
- The name rule is shared by Save and the tests.

## Behaviour

- `setConditionRows(next)` stores the row list; `ensureDiscoveredConditionRows()` then discovers each
  `RowCondition.symbols` name in row order. A discovered row is added once and marked
  `data-auto="true"`; it can be edited but not removed.
- A manual row has `.act-btn` Edit/Remove actions; Edit opens exactly one draft. Starting another edit
  or Add restores the previous committed value.
- Save reads the committed `data-value` and reports the full entry list through
  `setConditionsCallback`; Cancel restores the draft; Remove deletes a manual row and reports.
- Clear values empties every committed value but keeps the rows. Add creates an unsaved draft and sends
  nothing before Save.
- `applyDisabledCount` updates the section badge; `setConditionsStatus` writes the status line.
- `applyConditionsMessage` handles the host's condition envelope and returns whether it consumed it.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Invalid name | `conditionNameValid` false / `conditionEntryError` reason; Save is refused. |
| Duplicate name | `conditionEntryError` reports the existing row; not committed. |
| Empty draft name | Refused; no entry is reported. |
| Non-array `entries` payload | `renderConditionEntries` ignores it. |
| Empty committed value | Shown in the table but omitted from the evaluation map; the condition stays `unknown`. |
| Remove on a discovered row | No Remove action; the value remains editable. |
| Draft open, then another edit/Add | Previous draft is cancelled and restored. |
| Missing panel markup | `mountConditionsPanel` is a no-op. |

## Tests Required

`src/test/webview/components/conditionsPanel.test.ts` (validation/markup/callback) plus the
extension provider suite for persistence.

## Anti-patterns

- Persisting a draft or reading an input during `readConditionEntries`.
- Removing a discovered constant.
- Posting provider messages from the component.
