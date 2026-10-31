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

## Rules

- One row; no wrapping.
- Editor order: flexible slot, Collapse, Expand, Search.
- Diff order: left view/Prev/Next, centre Swap, right Search.
- Buttons use the shared `.tool`/`.sb-btn`/`.nav-btn` primitives; no one-off styles.
- Host wires actions through callbacks; the component never mutates host state.

## Tests Required

`src/test/webview/components/toolbar.test.ts`: order, classes, aria-labels, no inline styles.

## Anti-patterns

- Toolbar owning search or diff state.
- Duplicate button styles.
