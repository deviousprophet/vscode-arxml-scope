# Component Spec — Sidebar Details Panel

> Built from `component-template.md`. Nested panel of the Sidebar component.

## Scope / Trigger

Owns `src/webview/components/sidebar/detailsPanel/` (`detailsPanel.ts`, `detailsPanel.css`): the
Details tab markup, the empty state, the row -> field projection and the status line. The editor
composition root paints the body from the selected row and hosts the field editor.

## Layout

```text
src/webview/components/sidebar/detailsPanel/
    detailsPanel.ts      markup + inspectorFields + refusal helper
    detailsPanel.css     panel layout and status styles
src/webview/editorViewer.ts         composition root (painter)
src/test/webview/components/sidebar.test.ts
```

## Contract

```typescript
export interface InspectorFields {
    kind: string;
    label: string;
    definitionRef: string;
    shortName: string;
    variant: string;
    type: string;
    value: string;
    formats: ParameterFormat[];
    target: string;
    context: string;
    conditions: string;
    annotations: string;
    condition?: RowCondition;
}
export function inspectorFields(row: EcucRow): InspectorFields;
export function refusalShownInDetails(message: { inline?: boolean }, detailsHidden: boolean): boolean;
export function renderDetailsPanelHtml(): string;
```

## Rules

- The composition root supplies the selected `EcucRow`; `inspectorFields` never queries the row map or
  rendered DOM.
- The section header/body is static; a re-scan replaces only the body.
- A container's short name/definition are editable controls and are not repeated as read-only rows.
- Field refusals are inline in the details editor; the status line is the fallback for other tabs.
- No row-map, provider-message or `vscode` access.

## Behaviour

- With no selection the body shows the empty state (“Select a line to see its details.” plus the click
  or Space hint).
- A selected container renders editable Short name and Definition fields; its read-only duplicates are
  not emitted. Other kinds render Definition/Short name as rows.
- Type and value/formats come from the row data; a reference exposes Jump to target only when the row
  is `followable`.
- The status line shows follow failures and a field refusal that is not already inline in Details. An
  inline refusal visible in Details is not duplicated there.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| No selected row / row removed | Empty state; no stale fields. |
| Selected row is offscreen | Fields still come from `rowById`, never the rendered DOM. |
| Inline refusal while Details is visible | `refusalShownInDetails` is true; no status duplicate. |
| Inline refusal while another tab is active | Fallback status line shows it. |
| `#inspector` or body is missing | Paint is a no-op. |
| Selected row is a module | Read-only Definition/Short name rows; no field editor. |

## Tests Required

`src/test/webview/components/sidebar.test.ts` and the page suite cover field rendering, the empty
state and the status route.

## Anti-patterns

- Querying `#tree` for the selected row.
- Reading the draft input while painting.
- Owning a second copy of the selected row.
