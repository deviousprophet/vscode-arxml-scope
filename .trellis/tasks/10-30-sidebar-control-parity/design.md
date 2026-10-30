# Parent design: sidebar and control-surface parity

## 1. Target layout

```
body (column)
  .toolbar
    filter field        search field        count(s)   collapse expand
  #notice
  #content (row)
    #main (flex:1; scroll container)
      .document > #tree ...
    #sidebar-resizer (6px, role=separator)
    #sidebar (width var; column)
      #sbp-details.sb-tab-panel.active
        #inspector
          section.sb-section / sb-pane ...   (Node, Value, Reference, Conditions)
      #sbp-conditions.sb-tab-panel
        section.sb-section / sb-pane ...     (Condition values)
    #side-tabs (28px vertical strip)
      button.stab.active  DETAILS
      button.stab         CONDITIONS
```

The current `#inspector` aside becomes the root of the Details tab panel. The current
`#conditions-panel` block becomes the body of the Conditions section. The toolbar's Conditions and
Details toggles are removed.

## 2. Shared primitives and ownership

### Child 1 owns

- The sidebar shell: tab strip, tab panels, width resizer, tab selection state.
- The section/pane framework: 22px headers, chevrons, collapse, sashes, allocation, saved heights.
- Shared button CSS: `.sb-btn`, `.sb-btn-primary`, `.sb-btn-secondary`, `.sb-btn-add`,
  `.sb-btn-danger`, `.nav-btn`, `.act-btn` and their disabled/focus/hover states.
- The Details panel migration into sections; `#inspector` remains the panel root.
- Moving the existing Conditions panel markup into the Conditions tab as-is (content rework is
  child 2).
- Search/filter field CSS tokens (`.search-field`, `.search-input`, `.filter`, counts, clear) so
  child 3 cannot invent a second style.

### Child 2 owns

- Conditions row interaction: dataset-backed committed values, Edit/Save/Cancel, scanned/manual
  rules, badge correction, Add/Clear, message boundaries.
- It uses child 1's section body and button primitives; it does not add a toolbar panel or a second
  tab.

### Child 3 owns

- Filter/Search behavior: candidate set within `filterResult.visible`, jump/selection, Enter/F3,
  counts, highlight precedence.
- It uses child 1's field/button styles and places both fields in the toolbar.
- It does not add a separate find bar panel if the toolbar field is the chosen layout.

## 3. State model

One page state object persisted with `vscode.setState`:

```ts
interface EditorUiState {
  tab: 'details' | 'conditions';
  sidebarWidth: number;            // clamped 260..900
  panes: Record<string, number>;   // section id -> saved px
  collapsed: string[];             // section ids
  // existing filter/selection state stays in memory and is re-posted by the host
}
```

- A missing or invalid state falls back to `tab: 'details'`, 360px width and the default section
  heights.
- The host's re-scan (`setRows`) does not touch this object.
- The old `inspectorHidden` field is removed; a saved legacy object is ignored.
- The page keeps search/filter/selection in memory as today; only layout state is persisted.

## 4. Section allocation

Child 1 ports the Hex Scope `SidebarSections` behavior:

- `HEADER_H = 22`, `MIN_PANE = HEADER_H + 60`, `SASH_H = 6`.
- Only expanded pane bodies are allocated; collapsed panes keep their 22px header in place.
- A single expanded pane fills the panel.
- Saved/user sizes claim space first; fresh panes split the remainder; the last fresh pane absorbs
  rounding.
- Sashes resize only between two expanded panes; disabled sashes are inert and out of the tab order.
- Collapse/expand uses a 150ms `flex-basis` transition; resize/layout runs with a `no-transition`
  class; reduced motion disables the transition.

The pane algorithm is pure enough to unit-test separately (allocate, clamp, reset, keyboard step).

## 5. Button and field token system

Define once in the editor page CSS:

```css
.sb-btn { /* 3px radius, 10px/600 UI font, 2px 8px, gap 4, nowrap */ }
.sb-btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.sb-btn-secondary { background: transparent; border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
.sb-btn-add { border: 1px dashed var(--vscode-panel-border); color: var(--vscode-textLink-foreground); }
.sb-btn-danger { color: var(--vscode-errorForeground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
.nav-btn { width: 28px; height: 28px; ... }
.act-btn { width: 18px; height: 18px; opacity: 0; ... parent:hover/focus-within -> 1 }
```

Field style:

```css
.filter, .search-input {
  height: 26px; padding: 0 7px; min-width: 70px; width/flex 180px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  border-radius: 3px; font: 12px var(--vscode-editor-font-family, monospace);
}
.filter:focus, .search-input:focus { border-color: var(--vscode-focusBorder); }
```

The filter keeps a custom clear X and the native search cancel is suppressed. Search uses the same
height/radius but its own nav/count/clear actions.

## 6. Migration and compatibility

- Existing `#inspector` ids/field classes stay; tests that query `#inspector` find the Details panel
  root. Tests that assume the inspector is a flat aside or that `#details-toggle` exists must be
  updated.
- Existing `uiState.inspectorHidden` persistence is removed; a legacy saved state is ignored, not
  written back.
- The Conditions panel markup moves under `#sbp-conditions`; child 2 rewrites its contents. The
  toolbar Conditions toggle is removed.
- The toolbar becomes a two-field control row; filter behavior is unchanged. Search behavior is
  child 3.
- The diff page keeps its own toolbar and layout; only trivial shared token reuse is allowed.

## 7. Ordering and conflict zones

1. Child 1: `renderHtml.ts` layout/CSS/script, new sidebar shell/section module, tests. This is the
   highest-risk change and must land first.
2. Child 2: Conditions row script/CSS inside the existing tab slot. No layout changes.
3. Child 3: toolbar fields/search state inside the shell established by child 1.
4. Parent integration: full gate, host check, spec update, changelog, PR.

Conflict files: `src/editor/renderHtml.ts` (all three), `src/test/editor/uxDocument*.test.ts`,
`uxConditions.test.ts`, `uxFilter.test.ts`, `a11y.test.ts`, `src/editor/rowView.ts` (child 3 only).

## 8. Risks and rollback

- **Large page-script change** — keep the shell in a separate serialized module; boot-check the page.
- **Full pane parity** — port the tested allocation math rather than inventing a simpler one.
- **Details tests** — section bodies change the DOM; preserve `#inspector` and the details control
  classes so field-edit tests still find their inputs.
- **Tabs vs. old toggles** — remove the toggles in child 1 and update the manifest tests/spec in the
  same change; do not leave a second visibility path.
- **Rollback** — child 1 is one commit; reverting it restores the flex aside and the top Conditions
  panel. Children 2/3 revert independently.
