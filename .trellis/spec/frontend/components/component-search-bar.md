# Component Spec — SearchBar

> Built from `component-template.md`. Owns the query field, count, busy and navigation controls.

## Scope / Trigger

Owns `src/webview/components/searchBar/` (`searchBar.ts`, `searchBar.css`): the shared search input,
icon, clear, previous/next, fixed count slot and busy slot. Hosts own the search engine, candidates
and match index.

## Layout

```text
src/webview/components/searchBar/
    searchBar.ts     markup + feedback setters + callbacks
    searchBar.css    component styles
src/webview/editorViewer.ts / diffViewer.ts
src/test/webview/components/searchBar.test.ts
```

## Contract

```typescript
export interface SearchBarCallbacks {
    onExecute?(direction: 1 | -1): void;
    onCycle?(direction: 1 | -1): void;
    onClear?(): void;
    onEscape?(): void;
    onInput?(value: string): void;
}
export function renderSearchBarHtml(prefix: string, ariaLabel: string): string;
export class SearchBar {
    constructor(prefix: string, callbacks?: SearchBarCallbacks);
    mount(): void;
    id(name: string): string;
    input(): HTMLInputElement | null;
    value(): string;
    hasText(): boolean;
    setValue(value: string): void;
    clear(): void;
    focus(): void;
    setCount(text: string): void;
    setBusy(busy: boolean): void;
    setNavigationEnabled(enabled: boolean): void;
    setClearVisible(visible: boolean): void;
}
```

`prefix` is `''` for the editor and `'diff-'` for the diff, so the component owns no page-specific id.

## Rules

- Fixed count/busy slots; no layout shift when a run starts or ends.
- Enter runs a changed query; second Enter cycles; Shift+Enter goes back; Escape clears.
- Component holds only transient focus/typing state; candidates and index come from the host.
- Shared by editor and diff; no page-specific ids inside the component.

## Behaviour

- `Enter` reports `onExecute(1)`; `Shift+Enter` reports `onExecute(-1)`; `F3` also reports execute.
- `Escape` clears the field and reports `onEscape` (not `onClear`), so the host can reset its result set
  and return focus to the tree.
- The clear button reports `onClear`, clears the field and refocuses the input.
- The previous/next buttons report `onCycle(-1|1)`.
- `setCount`, `setBusy`, `setNavigationEnabled` and `setClearVisible` change only their own control;
  they never run a search or move focus.

## Validation & Error Matrix

| Condition | Behaviour |
|---|---|
| Empty input | `hasText()` is false; the host's execute path resets results. |
| Missing input element | Every getter/setter is a no-op; the component still mounts. |
| Missing count/busy/nav/clear element | That setter is a no-op. |
| `mount()` called twice | Second call is a no-op. |
| `setBusy(false)` | `data-busy="false"`; the slot keeps its space. |
| `setCount('')` | Count text is cleared without hiding the slot. |

## Tests Required

`src/test/webview/components/searchBar.test.ts`: markup, count states, busy visibility, key
behaviour, no inline styles.

## Anti-patterns

- Component scanning rows or owning the match set.
- Hiding the count slot with `display: none`.
