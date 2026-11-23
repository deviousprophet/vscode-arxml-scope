# Component Spec — DetailsEditor

> Built from `component-template.md`. Owns the Details field editor controls.

## Scope / Trigger

Owns `src/webview/components/detailsEditor/` (`detailsEditor.ts`, `detailsEditor.css`): the value,
short-name and definition-ref controls, the inline refusal reason and the Enter/Escape/Tab model.
The composition root owns the shared draft, the row data and the write.

Boundary rule: live keystrokes and selection requests go through `detailsEditorHost`; the component
never reads `rowById` or posts a provider message.

## Layout

```text
src/webview/components/detailsEditor/
    detailsEditor.ts     input guards + field builders + key handling
    detailsEditor.css    component styles
src/webview/editorMonaco.ts   composition root (host object)
src/test/webview/components/detailsEditor.test.ts
```

## Contract

```typescript
interface DetailsEditorHost {
    getRow(id: string): EcucRow | undefined;
    getSelectedId(): string | undefined;
    isDetailsTab(): boolean;
    showTab(name: string): void;
    showSection(id: string): void;
    renderedItem(id: string): HTMLElement | undefined;
    selectItem(item: HTMLElement): void;
    setSelection(id: string): void;
    postSelect(id: string): void;
    focusRow(id: string): boolean;
    updateInspector(): void;
    /** Route a live Details value into the page's shared draft. */
    previewEdit?(message: { type: 'edit'; nodeId: string; value: string; field?: string }): void;
    commitEdit(message: { type: 'edit'; nodeId: string; value: string; field?: string }): void;
    focusAdjacentParameter(fromId: string, direction: string): string | undefined;
}
export function setDetailsEditorHost(host: DetailsEditorHost): void;
export function resetDetailsEditorState(): void;
export function detailsInputAllowed(type: string, data: string): boolean;
export function detailsValueInput(row: EcucRow, data: InspectorFields): HTMLElement;
export function detailsContainerFields(row: EcucRow, data: InspectorFields): HTMLElement;
export function beginDetailsEdit(rowId: string, field?: string): boolean;
export function handleDetailsEditorMessage(message: EditorProviderToWebview): void;
```

## Rules

- One edit entry per field; the page owns the shared draft, so a re-scan re-seeds each control and
  restores the focused control's caret instead of dropping the text.
- A refusal keeps the typed text, marks `aria-invalid` and writes `/* reason */` beside the field.
- Enter is a no-op, Escape restores the host value, Tab moves to the sibling container field or
  lets focus leave the panel; only the page's `Ctrl+S` flush commits a host write.
- Integer/Float insertion guards only reject characters; the shared grammar still validates on the
  `Ctrl+S` flush.
- Boolean parameters use a `select` with `true`/`false`; other types use a text input with an
  appropriate `inputMode`.
- No inline document editor: the Document surface stays read-only.

## Behaviour

- A flushed rename may renumber the row; the host selection decides the flash target.
- A container shows editable Short name/Definition and no duplicate read-only rows.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Invalid character typed | `beforeinput` is prevented |
| Host refuses | Input keeps text and focus, error shown inline |
| Tab with no sibling | Focus leaves the panel; nothing is committed |
| Re-scan while pending | The rebuilt control is seeded from the shared draft and keeps focus/caret |
| Offscreen selected row | Field builders read the row data, never a rendered row |

## Tests Required

`src/test/webview/components/detailsEditor.test.ts`: guards, CSS ownership, callback-only host
access, key model and no `vscode`/`rowById` reads.

## Anti-patterns

- Calling `vscode.postMessage` or mutating the row model in the component.
- Writing a value attribute into `.value` or editing the Document inline.
- Keeping a second copy of the selected row inside the component.
