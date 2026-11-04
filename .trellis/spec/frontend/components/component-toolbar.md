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
    onMatchMode?(semantic: boolean): void;
    onContext?(active: boolean): void;
}
export function renderDiffToolbarHtml(searchHtml: string): string;
export class DiffToolbar {
    constructor(callbacks?: DiffToolbarCallbacks);
    mount(): void;
    setViewMode(changesOnly: boolean): void;
    setSwapped(swapped: boolean): void;
    setMatchMode(semantic: boolean, pending?: boolean): void;
    setContext(active: boolean): void;
}
```

## Rules

- One row; no wrapping. Diff buttons use `.tool.diff-tool` with a large icon over a small label.
- Editor order: flexible slot, Collapse, Expand, Search.
- Diff order: left `Show all / Show diff only` and `Semantic / Strict`; centre Prev, Next, Context,
  Swap; right status + Search.
- The Context toggle is disabled while Show all is active.
- Buttons use the shared `.tool`/`.sb-btn`/`.nav-btn` primitives; no one-off styles.
- Host wires actions through callbacks; the component never mutates host state.

## Behaviour

- Editor strip: `#collapse-all`, `#expand-all`, then the Search slot. The search field is always the
  last control.
- Diff strip: `#diff-view-all` / `#diff-view-diff` and `#diff-mode-semantic` / `#diff-mode-strict`
  are two-button view groups; `#diff-prev`, `#diff-next`, `#diff-context` and `#diff-swap` sit in the
  centred group; `#diff-match-status` and Search are on the right. `aria-pressed` reflects the active
  view, match mode, swap and context state; the buttons do not own the state.
- Every main diff button has an 18px inline SVG, an `aria-label`, and a `.lbl` underneath. Labels hide
  at <=720px while the accessible name remains.
- `setMatchMode(semantic, pending)` paints both mode buttons, sets `aria-busy` on the target and writes
  `Switching to Semantic/Strict…` into `#diff-match-status` while pending. The pending state is
  cleared by the page when the document or a `matchModeState` acknowledgement arrives.
- `setContext(active)` paints the standalone Context toggle. There is no summary slot in the diff
  toolbar.
- `mount()` is idempotent and binds each present control exactly once. A missing control is skipped.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| A button is missing from the shell | Its binding is skipped; the rest of the strip still mounts. |
| `mount()` is called twice | Second call is a no-op; no duplicate listeners. |
| A callback is absent | The click is handled but reports nothing. |
| `setViewMode` is called | The view `aria-pressed` values and the Context disabled state change. |
| `setSwapped` is called | Only `aria-pressed` changes on the swap button. |
| `setMatchMode` is called | Both mode buttons paint; the target carries `aria-busy` while pending. |
| `setContext` is called | Only the Context `aria-pressed` changes. |

## Tests Required

`src/test/webview/components/toolbar.test.ts`: order, classes, aria-labels, no inline styles.

## Anti-patterns

- Toolbar owning search or diff state.
- Duplicate button styles.
