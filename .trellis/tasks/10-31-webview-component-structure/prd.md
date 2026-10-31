# Hex Scope-style webview structure and components

## Goal

Restructure `src/` so the ECUC editor and semantic diff follow the same webview architecture as Hex Scope: one `src/webview` runtime, self-contained reusable components, component-owned styles, composition roots, and tests mirroring ownership.

## Requirements

**Structure**

- `src/webview/` holds browser-only code: composition roots, components, render helpers, styles.
- Each reusable UI unit lives under `src/webview/components/<Name>/` with `<Name>.ts`, its render layer and `<Name>.css`.
- A component owns its markup, transient UI state, input behaviour and styles; it never reads host globals directly.
- Composition roots (`editorViewer.ts`, `diffViewer.ts`) own wiring and DOM effects.
- Shared tokens/resets/layout live under `src/webview/styles/`; component CSS lives with the component.
- Pure logic lives under `src/core/`; extension-host filesystem/VS Code effects live outside `src/webview/`.
- Tests mirror: `src/test/core`, `src/test/webview`, `src/test/extension`.

**Reusable components**

- `components/documentTree/`: the Document tree view, row builders, guides, styles.
- `components/diffView/`: two-pane diff surface composing two document-tree instances.
- `components/toolbar/`: shared toolbar primitives and the editor/diff toolbars.
- `components/searchBar/`: query field, count, busy and navigation.
- `components/sidebar/`: sidebar shell, Details and Conditions panels.
- `components/contextMenu/`: row context menu.
- Shared render helpers move to `src/webview/render/`.

**Behaviour**

- Editor and diff behaviour is unchanged by the move.
- Diff panes keep independent virtual windows, synchronized scrolling and native scrollbars.
- Pending fixes (single vertical scrollbar, brace/guide rendering, split thickness, large-file responsiveness) land before the move and stay green.

## Constraints

- No framework adoption.
- No persisted state or payload changes.
- Component CSS must be importable from its component module, matching Hex Scope; the build may add a text loader for CSS while the pages stay server-rendered.
- Do not change diff model semantics.

## Acceptance Criteria

- [ ] `src/webview` exists with composition roots, components, render helpers and styles.
- [ ] Each extracted component has its own folder, CSS and test at `src/test/webview/components/<component-name>.test.ts`.
- [ ] Each component has a spec under `.trellis/spec/frontend/components/`, copied from the Hex Scope template.
- [ ] The editor and diff import the same DocumentTree/diff components.
- [ ] No webview module imports `vscode`.
- [ ] Old paths are removed; no duplicate renderer remains.
- [ ] Editor and diff behaviour is unchanged.
- [ ] `npm run check-types`, `npm run lint`, `npm test`, `npm run package` pass.
