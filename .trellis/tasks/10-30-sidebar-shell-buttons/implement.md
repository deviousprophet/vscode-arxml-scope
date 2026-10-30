# Sidebar shell — implementation plan

## Ordered checklist

### 1. Pure pane/width helpers

- [ ] Create `src/editor/sidebarShell.ts` with `clampSidebarWidth`, `allocatePanes`, pane/state types,
  and `sidebarShellScript()`.
- [ ] Add unit tests for the allocation math (single pane, fresh split, saved sizes, min clamp,
  rounding) and width clamp.
- [ ] Keep the module free of `vscode` imports; the page script uses only DOM globals.

### 2. Static shell markup

- [ ] Replace the `#inspector` aside in `renderHtml.ts` with:
  - `#sidebar-resizer`;
  - `#sidebar` containing `#sbp-details` and `#sbp-conditions`;
  - `#side-tabs` with the two `stab` buttons;
  - the four Details section shells and their bodies;
  - the Conditions section shell with the existing `#conditions-panel` moved inside.
- [ ] Add role/aria wiring (`tablist`, `tab`, `tabpanel`, `separator`, section `button`/`region`).
- [ ] Add sashes between sections.
- [ ] Remove `#conditions-toggle`, `#details-toggle` and their markup.

### 3. Shell behavior

- [ ] Inject `${sidebarShellScript()}` before `TREE_SCRIPT`; call `mountSidebarShell()` at boot.
- [ ] Implement tab switching, `active`/`aria-selected`/`hidden` updates and `uiState.tab`.
- [ ] Implement sidebar drag and ArrowLeft/ArrowRight resize; clamp and persist.
- [ ] Implement section collapse/expand from click, Enter/Space and ArrowLeft/Right.
- [ ] Implement sash drag, ArrowUp/Down, double-click reset, adjacent-collapsed disabled state.
- [ ] Implement pane layout/allocation, `ResizeObserver`, `no-transition` during resize and
  reduced-motion handling.
- [ ] Persist `tab`, `sidebarWidth`, `panes` and `collapsed` via `vscode.setState`; ignore and drop
  the legacy `inspectorHidden`.
- [ ] Ensure a re-scan does not reset the shell.

### 4. Details migration

- [ ] Refactor `updateInspector` to write into the four stable bodies instead of clearing the whole
  inspector.
- [ ] Move the details value input, container fields, target/context, Jump/Reveal and condition rows
  into the matching bodies.
- [ ] Keep `#inspector` and the existing field/action classes/ids.
- [ ] Add `.sb-empty` content for empty bodies.
- [ ] Remove the `details-toggle` listener and `uiState.inspectorHidden` assertions.

### 5. Buttons and fields

- [ ] Add `.sb-btn`/primary/secondary/add/danger, `.nav-btn`, `.act-btn` and the shared input/field
  CSS.
- [ ] Convert toolbar Collapse/Expand, inspector Jump/Reveal and empty-clear to the shared classes.
- [ ] Restyle the Filter field to the shared field style; keep the custom clear X and native
  cancellation suppression.
- [ ] Leave Conditions actions for child 2; leave Search for child 3, but provide the field class.

### 6. Tests and gates

- [ ] Add `src/test/editor/sidebarShell.test.ts` for markup, tabs, width, allocation, sections,
  sashes, persistence and the absence of the old toggles.
- [ ] Update `uxDocument*`, `a11y`, `virtualPage` and render tests for the new DOM.
- [ ] Extend `scripts/check-webview-boot.cjs` if needed for the sidebar script.
- [ ] Run `check-types`, `lint`, `test`, `package`.
- [ ] Extension Development Host: tabs, drag/keyboard resize, all sashes, collapse, focus outlines,
  theme contrast, a re-scan preserving tab/width/sections.

## Risky files

- `src/editor/renderHtml.ts` — largest change; keep the shell markup static and the logic in
  `sidebarShell.ts`.
- `src/editor/ecucDetailsEditor.ts` — inputs move into section bodies; keep event ownership.
- Existing tests that assume the flat aside or the toolbar toggles must be updated, not weakened.

## Rollback

Restore the aside/top-panel markup, remove the shell script and section state, and reinstate the
toolbar toggles. Child 2/3 remain untouched.
