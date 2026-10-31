# Component Spec — DetailsEditor

> Built from `component-template.md`. Owns the Details field editor controls.

## Scope / Trigger

Owns `src/webview/components/detailsEditor/` (`detailsEditor.ts`, `detailsEditor.css`): the value,
short-name and definition-ref controls, the single draft per field, the inline refusal reason and
the Enter/Escape/Tab model. The host owns row data, validation and the write.

Boundary rule: commits and selection requests go through `detailsEditorHost`; the component never
reads `rowById` or posts a provider message.

## Layout

```text
src/webview/components/detailsEditor/
    detailsEditor.ts     input guards + field builders + key handling
    detailsEditor.css    component styles
src/webview/editorViewer.ts   composition root (host object)
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

- One edit entry per field; a re-scan (`message.type === 'document'`) clears every draft.
- A refusal keeps the typed text, marks `aria-invalid` and writes `/* reason */` beside the field.
- Enter commits, Escape restores the committed value, Tab moves to the sibling container field or
  commits and lets focus leave the panel.
- Integer/Float insertion guards only reject characters; the host grammar still validates on commit.
- Boolean parameters use a `select` with `true`/`false`; other types use a text input with an
  appropriate `inputMode`.
- No inline document editor: the Document surface stays read-only.

## Behaviour

- A committed rename may renumber the row; the host selection decides the flash target.
- A container shows editable Short name/Definition and no duplicate read-only rows.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Invalid character typed | `beforeinput` is prevented |
| Host refuses | Input keeps text and focus, error shown inline |
| Tab with no sibling | Commit, focus leaves the panel |
| Re-scan while pending | Draft cleared only when the host answers |
| Offscreen selected row | Field builders read the row data, never a rendered row |

## Tests Required

`src/test/webview/components/detailsEditor.test.ts`: guards, CSS ownership, callback-only host
access, key model and no `vscode`/`rowById` reads.

## Anti-patterns

- Calling `vscode.postMessage` or mutating the row model in the component.
- Writing a value attribute into `.value` or editing the Document inline.
- Keeping a second copy of the selected row inside the component.
