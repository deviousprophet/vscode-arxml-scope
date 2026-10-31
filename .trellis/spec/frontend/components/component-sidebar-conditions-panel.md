# Component Spec — Sidebar Conditions Panel

> Built from `component-template.md`. Nested panel of the Sidebar component.

## Scope / Trigger

Owns `src/webview/components/sidebar/conditionsPanel/` (`conditionsPanel.ts`,
`conditionsPanel.css`): the SW-SYSCOND value list, discovered read-only rows, the one editable
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
export function conditionsPanelScript(): string; // mount/setRows/setCallback
```

## Rules

- One draft at a time; starting another cancels the first and restores its committed value.
- Discovered rows (`data-auto="true"`) are read-only and have no Remove; manual rows do.
- The committed `data-value` is the only value read; a draft input is never persisted.
- Clear empties values but keeps rows; Add creates an unsaved draft and sends nothing before Save.
- Entries are reported through `onConditionsChange`, never `vscode.postMessage`.
- The name rule is shared by Save and the tests.

## Tests Required

`src/test/webview/components/conditionsPanel.test.ts` (validation/markup/callback) plus the
extension provider suite for persistence.

## Anti-patterns

- Persisting a draft or reading an input during `readConditionEntries`.
- Removing a discovered constant.
- Posting provider messages from the component.
