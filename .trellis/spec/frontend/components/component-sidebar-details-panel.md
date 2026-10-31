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
interface InspectorFields { /* kind, label, definitionRef, … */ }
export function inspectorFields(row: EcucRow): InspectorFields;
export function refusalShownInDetails(message: { inline?: boolean }, detailsHidden: boolean): boolean;
export function renderDetailsPanelHtml(): string;
export function detailsPanelScript(): string; // serialized field projection
```

## Rules

- The panel reads the selected row from the host's row map, never from rendered DOM.
- The section header/body is static; a re-scan replaces only the body.
- A container's short name/definition are editable controls and are not repeated as read-only rows.
- Field refusals are inline in the details editor; the status line is the fallback for other tabs.
- No row model, provider message or `vscode` access.

## Tests Required

`src/test/webview/components/sidebar.test.ts` and the page suite cover field rendering, the empty
state and the status route.

## Anti-patterns

- Querying `#tree` for the selected row.
- Reading the draft input while painting.
- Owning a second copy of the selected row.
