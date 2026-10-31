# Component Spec — Sidebar

> Built from `component-template.md`. Owns the editor right sidebar shell and its tabs.

## Scope / Trigger

Owns `src/webview/components/sidebar/` (`sidebar.ts`, `sidebar.css`, `detailsPanel/`,
`conditionsPanel/`): the tab strip, resizable panel shell and the Details/Conditions panel hosts.
The editor composition root owns selected row data, edit state and actions.

## Layout

```text
src/webview/components/sidebar/
    sidebar.ts / sidebar.css
    detailsPanel/       detailsPanel.ts + css
    conditionsPanel/    conditionsPanel.ts + css
src/webview/editorViewer.ts
src/test/webview/components/sidebar.test.ts
```

## Rules

- Sidebar owns tab/width/pane UI state only; row data and edits are host inputs.
- Details panel reads host-provided fields; it never reads the row model directly.
- Conditions panel emits callbacks for edit/save/cancel/remove; no persistence.
- Component CSS colocated; shared `.sb-*` primitives stay in the sidebar component.

## Tests Required

`src/test/webview/components/sidebar.test.ts`: tab switching, resizer, details/conditions parity,
no global state reads. `src/test/webview/components/conditionsPanel.test.ts` covers the nested
panel validation and callback.

## Anti-patterns

- Sidebar owning the document model or writing edits.
- Duplicate details/conditions state outside the host.
