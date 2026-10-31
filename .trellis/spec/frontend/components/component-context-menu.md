# Component Spec — ContextMenu

> Built from `component-template.md`. Owns the row context menu.

## Scope / Trigger

Owns `src/webview/components/contextMenu/` (`contextMenu.ts`, `contextMenu.css`): the one
`role="menu"` with **Duplicate** and **Delete**, its viewport clamping and its keyboard model.
Hosts own confirmation, structure planning and the write.

Boundary rule: the component never reads a host row map and never posts a provider message. It
reports one `(action, nodeId)` through `contextMenuHost.onAction`.

## Layout

```text
src/webview/components/contextMenu/
    contextMenu.ts       markup + menu controller script
    contextMenu.css      component styles
src/webview/editorViewer.ts   composition root
src/test/webview/components/contextMenu.test.ts
```

## Contract

```typescript
interface ContextMenuHost {
    selectItem(item: HTMLElement): void;
    rowElement(nodeId: string): HTMLElement | undefined;
    onAction(action: 'duplicate' | 'delete', nodeId: string): void;
}
export function renderContextMenuHtml(): string;
export function renderContextMenuStyleTag(nonce: string): string;
export function mountContextMenu(treeElement: Element, host: ContextMenuHost): void;
export function hideRowMenu(restoreFocus: boolean): void;
```

## Rules

- Only `container` and `parameter` rows open the menu; every other kind keeps the native menu.
- Right-click selects the row first and focuses the first item.
- Coordinates are written to the nonce `#row-menu-style` stylesheet, never an inline style.
- The menu closes before the action is reported; Escape restores focus to the row.
- Closes on Escape, outside pointerdown, scroll, resize and blur.
- No host write, no confirmation and no message code in the component.

## Behaviour

- ArrowUp/ArrowDown cycle the two items.
- `setRows`/a re-scan hides the menu through the same `hideRowMenu(false)` path.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Non-container/parameter row | Native context menu |
| Menu open + Escape | Closes, focus returns to the row |
| Missing menu markup | All entry points are no-ops |
| Action clicked | One callback with the stored node id |

## Tests Required

`src/test/webview/components/contextMenu.test.ts`: shell, open guard, clamping, action callback,
Escape/outside close and theme-token styles.

## Anti-patterns

- Posting `{ type: 'duplicate' | 'delete' }` from the component.
- Selecting or mutating host state inside the menu.
- Writing `style="left:…"` into the DOM.
