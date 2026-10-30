# Sidebar shell, tabs, sections and button primitives

## Goal

Replace the flat right inspector and the top Conditions block with a Hex Scope-style right sidebar:
a vertical two-tab strip (**Details**, **Conditions**), a resizable sidebar, full collapsible and
resizable section panes with saved heights, and one shared button/field visual system used by the
whole ECUC editor.

This child owns the shell and the shared primitives. The Conditions content rework and the Find
behavior are separate children.

## Confirmed facts

- The current page is `#main` (tree) + `#inspector` aside; the Conditions panel is a full-width block
  under the toolbar (`src/editor/renderHtml.ts`).
- The toolbar currently has Filter, Conditions, count, Collapse, Expand and Details buttons.
- `updateInspector` clears `#inspector` and rebuilds a flat list; the details editor script owns the
  value/container inputs.
- Hex Scope's shell is `#sidebar-resizer` + `#sidebar` + right-edge `#side-tabs`; tabs are vertical
  uppercase buttons with an active right-border accent.
- Hex Scope's sections are 22px header panes with chevrons, independent body scroll, 6px sashes,
  drag/keyboard/double-click resizing, saved heights, `MIN_PANE` clamping and a single-pane fill.
- Hex Scope's buttons are `.sb-btn-primary`, `.sb-btn-secondary`, `.sb-btn-add`, `.sb-btn-danger`,
  `.nav-btn` and `.act-btn`; the search field is a 26px input-background field
  (`research/hex-scope-ui-reference.md`).
- Full parity was explicitly requested.

## Requirements

### Sidebar and tabs

- **R1** The right side becomes `#sidebar-resizer` + `#sidebar` + `#side-tabs`, with tabs **Details**
  (default) and **Conditions**. No horizontal sidebar header.
- **R2** The tab strip is a 28px vertical strip at the far right. Tabs use vertical uppercase 10px
  text, 3px active right border, hover background and a focus outline.
- **R3** Clicking a tab activates its panel; only one panel is visible. The active tab and panel
  carry `.active`; the strip uses `role=tablist`, each tab `role=tab`, `aria-selected`,
  `aria-controls`, and each panel `role=tabpanel`.
- **R4** The sidebar width is resizable by drag and ArrowLeft/ArrowRight, clamped to 260–900px and
  persisted. It has a left border and uses the panel background token.
- **R5** The toolbar Conditions and Details toggle buttons are removed. The tabs are the only panel
  switchers. The legacy `inspectorHidden` saved state is ignored, not written back.

### Sections and panes

- **R6** Details is split into sections: **Node**, **Value**, **Reference**, **Conditions &
  annotations**. Conditions is one section: **Condition values**.
- **R7** Every section is a pane with a 22px header: chevron, uppercase 11px bold label, optional
  header action slot, `role=button`, `aria-expanded`, `aria-controls`, Enter/Space toggle,
  ArrowLeft collapse, ArrowRight expand.
- **R8** Section bodies scroll independently (`role=region`, `aria-labelledby`). A single expanded
  section fills the panel; collapsed sections stay in DOM order at their 22px header.
- **R9** A 6px `role=separator` sash between adjacent sections supports drag, ArrowUp/ArrowDown and
  double-click reset. Sashes adjacent to a collapsed section are disabled, dimmed, `aria-disabled`
  and out of the tab order.
- **R10** Pane sizing follows Hex Scope: `HEADER_H=22`, `MIN_PANE=HEADER_H+60`, `SASH_H=6`, saved
  user sizes claimed first, fresh panes share the remainder, the last absorbs rounding, and a single
  expanded pane fills the panel.
- **R11** Collapse/expand animates 150ms; layout/resize runs without the transition; reduced motion
  disables the animation.
- **R12** Tab, sidebar width, pane heights and collapsed sections persist through `vscode.setState`
  and survive a re-scan. A missing/invalid state falls back to Details, 360px, default heights.

### Details migration

- **R13** `#inspector` remains the Details panel root and the existing details field/edit classes
  remain. `updateInspector` writes the four section bodies instead of clearing the whole inspector.
- **R14** The value editor, container short-name/definition inputs, Jump to target and Reveal in
  source actions keep working and are placed in the appropriate section.
- **R15** The details editor script continues to own Enter/Escape/Tab for its inputs.
- **R16** Empty sections show a quiet empty state inside the body; the headers remain usable.

### Conditions tab placement

- **R17** The existing Conditions panel markup moves into the Conditions tab as the body of the
  **Condition values** section. Its internal actions are reworked by child 2, not here.
- **R18** The Conditions tab is reachable without a toolbar toggle; a document with conditions does
  not auto-switch tabs. The selected tab is independent of filter/search.

### Buttons and fields

- **R19** Add the shared button system and use it for every editor button/action:
  primary (Save/confirm), secondary (Cancel/toolbar), add (dashed accent), danger (destructive),
  nav icon (search/filter/toolbar), compact row action (edit/delete).
- **R20** Button metrics follow Hex Scope: 3px radius, 10px/600 UI font, 2px 8px padding, 28px nav
  icons, 18px row actions, focus/disabled states.
- **R21** Define the shared field style used by Filter and the later Search: 26px height,
  input-background/foreground/border, 3px radius, editor font 12px, focus border, custom clear X,
  native search cancel suppressed.
- **R22** Use `--vscode-*` tokens only; no new hex/rgba literal, no inline style.
- **R23** Replace the current toolbar Collapse/Expand/Details/empty-clear/inspector action buttons
  with the shared classes. The top Conditions toggle is removed.

### Safety and tests

- **R24** No new dependency, no file write, no second sidebar or details renderer.
- **R25** The page boot gate passes in production; `check-types`, `lint`, `test` and `package` pass.
- **R26** Tests cover tabs, width resize/clamp, pane allocation, sash keyboard/reset/disabled state,
  section keyboard, details edit/reveal still working, the Conditions tab slot, button variants and
  the absence of the old toggles.

## Acceptance criteria

- [ ] **AC1** The editor shows a right-edge vertical **Details** / **Conditions** tab strip; Details
  is selected first; clicking either tab shows only its panel.
- [ ] **AC2** Sidebar drag and arrow keys resize and persist width within 260–900px.
- [ ] **AC3** Sections collapse/expand with keyboard and mouse; bodies scroll independently.
- [ ] **AC4** Sashes resize adjacent expanded sections, disable next to collapsed ones, support
  keyboard and reset; heights persist.
- [ ] **AC5** A single expanded section fills the panel; collapsed sections remain as 22px headers.
- [ ] **AC6** Details is split into four sections and all existing value/container editing and reveal
  actions still work.
- [ ] **AC7** The Conditions panel exists inside the Conditions tab; no toolbar Conditions panel or
  Details toggle remains.
- [ ] **AC8** Toolbar, details actions, empty clear, pane headers and row actions use the shared
  button hierarchy; Filter uses the shared field style.
- [ ] **AC9** No hard-coded colour, inline style, dependency or file write is introduced.
- [ ] **AC10** Full gates and the production boot check pass; the Extension Development Host shows
  correct tabs, resize, sashes, focus and theme contrast.

## Out of scope

- Conditions row editing/badge behavior (child 2).
- Find/search behavior (child 3).
- Diff page sidebar redesign.
- Persisting tab/section state across editor reloads (only `vscode.setState` lifetime).
- New editor features beyond the layout/control migration.

## Dependencies

- None. This is the first child and provides the shell/primitives for the other two.
