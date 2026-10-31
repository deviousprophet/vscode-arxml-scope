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

## Rules

- Fixed count/busy slots; no layout shift when a run starts or ends.
- Enter runs a changed query; second Enter cycles; Shift+Enter goes back; Escape clears.
- Component holds only transient focus/typing state; candidates and index come from the host.
- Shared by editor and diff; no page-specific ids inside the component.

## Tests Required

`src/test/webview/components/searchBar.test.ts`: markup, count states, busy visibility, key
behaviour, no inline styles.

## Anti-patterns

- Component scanning rows or owning the match set.
- Hiding the count slot with `display: none`.
