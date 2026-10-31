# Component Spec — Toolbar

> Built from `component-template.md`. Owns the editor and diff toolbar strips.

## Scope / Trigger

Owns `src/webview/components/toolbar/` (`toolbar.ts`, `toolbar.css`): the toolbar layout primitives,
shared button classes and the editor/diff control arrangement. Hosts own the actions and state.

## Layout

```text
src/webview/components/toolbar/
    toolbar.ts       markup builder + control wiring
    toolbar.css      component styles
src/webview/editorViewer.ts / diffViewer.ts
src/test/webview/components/toolbar.test.ts
```

## Contract

```typescript
export interface EditorToolbarCallbacks {
    onCollapseAll?(): void;
    onExpandAll?(): void;
}
export function renderEditorToolbarHtml(searchHtml: string): string;
export class EditorToolbar {
    constructor(callbacks?: EditorToolbarCallbacks);
    mount(): void;
}

export interface DiffToolbarCallbacks {
    onViewAll?(): void;
    onViewDiff?(): void;
    onPrev?(): void;
    onNext?(): void;
    onSwap?(): void;
}
export function renderDiffToolbarHtml(searchHtml: string): string;
export class DiffToolbar {
    constructor(callbacks?: DiffToolbarCallbacks);
    mount(): void;
    setViewMode(changesOnly: boolean): void;
    setSwapped(swapped: boolean): void;
}
```

## Rules

- One row; no wrapping.
- Editor order: flexible slot, Collapse, Expand, Search.
- Diff order: left view/Prev/Next, centre Swap, right Search.
- Buttons use the shared `.tool`/`.sb-btn`/`.nav-btn` primitives; no one-off styles.
- Host wires actions through callbacks; the component never mutates host state.

## Behaviour

- Editor strip: `#collapse-all`, `#expand-all`, then the Search slot. The search field is always the
  last control.
- Diff strip: `#diff-view-all` / `#diff-view-diff` (a two-button group), `#diff-prev`, `#diff-next`,
  the centred `#diff-swap`, then the Search slot. `aria-pressed` reflects the active view and swap
  state; the buttons do not own the state.
- `mount()` is idempotent and binds each present control exactly once. A missing control is skipped.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| A button is missing from the shell | Its binding is skipped; the rest of the strip still mounts. |
| `mount()` is called twice | Second call is a no-op; no duplicate listeners. |
| A callback is absent | The click is handled but reports nothing. |
| `setViewMode` is called | Only `aria-pressed` changes on the two view buttons. |
| `setSwapped` is called | Only `aria-pressed` changes on the swap button. |

## Tests Required

`src/test/webview/components/toolbar.test.ts`: order, classes, aria-labels, no inline styles.

## Anti-patterns

- Toolbar owning search or diff state.
- Duplicate button styles.
