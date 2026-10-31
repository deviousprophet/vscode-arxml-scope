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

## Contract

```typescript
export type SidebarTab = 'details' | 'conditions';
export interface PaneSpec {
    id: string;
    saved: number | null;
    collapsed: boolean;
    user: boolean;
}
export interface SidebarUiState {
    tab: SidebarTab;
    sidebarWidth: number;
    panes: Record<string, number>;
    collapsed: string[];
}
export function renderSidebarHtml(): string;
export function mountSidebarShell(): void;
export function setSidebarState(savedState: unknown): void;
export function getSidebarState(): SidebarUiState;
export function setSidebarPersistence(persist: () => void): void;
export function showSidebarTab(name: string): void;
export function showSidebarSection(id: string): void;
export function layoutSidebarPanes(): void;
export class SidebarPaneView {
    constructor(root: Element);
    // section registration, layout, collapse and sash drag are internal
}
```

## Rules

- Sidebar owns tab/width/pane UI state only; row data and edits are host inputs.
- The composition root passes the selected row to `inspectorFields`; the panel never reads the row
  map or the rendered DOM.
- Conditions panel emits callbacks for edit/save/cancel/remove; no persistence.
- Component CSS colocated; shared `.sb-*` primitives stay in the sidebar component.

## Behaviour

- The default tab is Details; `showSidebarTab('conditions')` activates the Conditions panel and updates
  the roving tab/`aria-selected` state.
- The width starts at 360px and is clamped to 260–900px and to the available viewport. Only a user
  resize is persisted.
- The tab strip is a 28px vertical rail; at `<=720px` it becomes horizontal and the sidebar moves below
  the document with `max-height: 45vh`.
- Section headers are 22px buttons with `aria-expanded`/`aria-controls`; the body is the only scroller.
  A rendered sash drags, supports ArrowUp/ArrowDown (±10px) and resets on double click.
- `showSidebarSection(id)` expands the owning pane before focus moves to a Details field.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Saved state is absent or malformed | Falls back to Details, 360px and default pane sizes via `loadUiState`. |
| Saved width is outside 260–900 | Clamped; a non-finite width falls back to the minimum. |
| Missing sidebar/resizer/tabs element | `mountSidebarShell` returns without throwing. |
| Tab key on the tab strip | Arrow keys move the roving tab; Enter/Space activates. |
| Sash drag on a collapsed pane | The sash is `.disabled` and does not resize. |
| Viewport `<=720px` | Resizer hidden; sidebar becomes the stacked layout. |

## Tests Required

`src/test/webview/components/sidebar.test.ts`: tab switching, resizer, details/conditions parity,
no global state reads. `src/test/webview/components/conditionsPanel.test.ts` covers the nested
panel validation and callback.

## Anti-patterns

- Sidebar owning the document model or writing edits.
- Duplicate details/conditions state outside the host.
