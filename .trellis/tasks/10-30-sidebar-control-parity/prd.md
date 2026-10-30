# Sidebar and control-surface parity with Hex Scope

## Goal

Redesign the ECUC editor's right side to match the Hex Scope sidebar model, and make the editor's
controls share one visual system:

1. The Details inspector and the Conditions table become two tabs in a right-edge, vertically
   tabbed sidebar.
2. Sidebar tabs, sections, pane handling, resizing and persistence follow Hex Scope's behavior
   (full parity).
3. The Filter and Search controls use Hex Scope's search-bar visual language.
4. Every button and row action uses the shared Hex Scope-style hierarchy: primary, secondary,
   add (dashed accent), danger, nav icon and compact row action.

This parent owns the source requirements, child mapping, shared tokens and final integration review.
The implementation is split into three children; the parent does not implement product code itself.

## Confirmed facts

- The current page is one flex row: `#main` plus a right `#inspector` aside; the Conditions panel is
  a full-width block under the toolbar (`src/editor/renderHtml.ts`).
- The current toolbar has Filter, Conditions, a filter count, Collapse, Expand and Details buttons.
- Hex Scope's sidebar shell is `#sidebar-resizer` + `#sidebar` + right-edge `#side-tabs`; tabs use
  vertical uppercase text and a right-border accent; sections are collapsible/resizable panes with
  22px headers, chevrons, sashes and saved heights (`sidebar.ts`, `sidebar.css`).
- Hex Scope's search bar is a toolbar flex row with a 26px input, nav buttons, a 14ch count and a
  clear action (`searchBar.ts`, `searchBar.css`).
- Hex Scope's shared buttons are `.sb-btn-primary`, `.sb-btn-secondary`, `.sb-btn-add`,
  `.sb-btn-danger`, `.nav-btn` and `.act-btn` (`base.css`).
- Full reference evidence is in `research/hex-scope-ui-reference.md`.
- The existing planned tasks `10-30-conditions-edit-flow` and `10-30-find-bar-search` are children
  of this parent.

## Task map and ordering

| Child | Deliverable | Order |
|---|---|---|
| `10-30-sidebar-shell-buttons` | Sidebar shell, vertical tabs, full section pane parity, shared button CSS, Details migration, Conditions tab slot | 1 |
| `10-30-conditions-edit-flow` | Conditions content inside the Conditions tab: badge fix, scanned/manual rules, Edit/Save/Cancel | 2 |
| `10-30-find-bar-search` | Filter and Search fields, Hex Scope search-bar styling, filtered-set Find behavior | 3 |

Child 1 establishes the layout, tab/section classes and button primitives. Children 2 and 3 consume
them; neither may create a second sidebar or button system. Children 2 and 3 can be implemented
after child 1 in either order, but the final integration follows Conditions → Find.

## Requirements

### Sidebar

- **P1** The right side is a sidebar with a right-edge vertical tab strip and two tabs: **Details**
  (default) and **Conditions**.
- **P2** The sidebar has a resizable width (drag + keyboard, clamped, persisted per webview), a left
  border and the Hex Scope panel background.
- **P3** Each tab panel fills the available height; each expanded section body scrolls
  independently.
- **P4** Sections use 22px headers with a chevron, uppercase 11px bold label, `role=button`,
  `aria-expanded`, `aria-controls`, Enter/Space toggle and ArrowLeft/Right collapse/expand.
- **P5** Sections are panes: a 6px `role=separator` sash between them supports drag,
  ArrowUp/ArrowDown, double-click reset, `MIN_PANE` sizing and saved heights. A single expanded
  section fills the panel. Collapse/expand animates unless reduced motion is requested.
- **P6** Details is split into sections (Node, Value, Reference, Conditions/Annotations). Conditions
  is one section containing the table and its actions.
- **P7** The toolbar `Conditions` and `Details` buttons are removed; the tabs are the only panel
  switchers. The saved `inspectorHidden` concept is replaced by the selected tab.
- **P8** The existing `#inspector` element remains the Details panel root so existing selection and
  details tests can be adapted without a second details surface.

### Controls and buttons

- **P9** One shared button system is used everywhere in the ECUC editor:
  - primary (Save/confirm), secondary (Cancel/toolbar actions), add (dashed accent), danger
    (destructive), nav icon (search/filter/toolbar), compact row action (Edit/Delete).
- **P10** Button metrics follow Hex Scope: 3px radius, 10px/600 UI font for text buttons, 2px 8px
  padding, compact 18px row actions, 28px nav icons; focus outlines and disabled states included.
- **P11** All colours use `--vscode-*` tokens (see the token mapping in the research file). No new
  hex/rgba literals.
- **P12** The Filter and Search fields share the Hex Scope search-input style: 26px height,
  input-background/border, 3px radius, editor font, focus border, custom clear X and tabular count.
- **P13** Search controls follow the Hex Scope layout: magnifier/search action, previous/next nav
  buttons, clear, and a 14ch match count. Filter keeps its own clear/count but the same field style.

### Conditions and Find content

- **P14** Conditions moves out of the toolbar and into the Conditions tab. Its table keeps the
  auto-discovered constants and implements the approved edit/save/cancel + scanned/manual rules.
- **P15** Find searches within the filter's displayed rows, jumps instead of hiding, and uses the
  shared search field. The filter remains a visibility control.
- **P16** The two behaviours are independent: opening the Conditions tab does not affect search or
  filter; searching does not change the filter.

### State, accessibility and safety

- **P17** Tab selection, sidebar width and section heights persist through `vscode.setState` and
  survive a re-scan. A document change must not reset the active tab or collapse state.
- **P18** The tab strip exposes `role=tablist`/`role=tab`/`aria-selected`/`aria-controls`; panels
  have `role=tabpanel`; sashes and the resizer have proper separator semantics.
- **P19** No new dependency, no file write, no second details renderer, no duplicate sidebar.
- **P20** Existing evaluator, row, diff, menu, editing and activation behaviour stays green; the diff
  page is out of scope for the sidebar (shared button tokens may be reused only if trivial).

## Cross-child acceptance criteria

- [ ] The editor shows a right sidebar with vertical **Details** and **Conditions** tabs; Details is
  selected on first open.
- [ ] The sidebar width is resizable by drag and keyboard and persists; sections collapse/expand and
  resize with sashes and persist their heights.
- [ ] The Details tab contains the inspector split into sections and keeps the existing value/field
  editing and reveal actions working.
- [ ] The Conditions tab contains the full Conditions table with the edit/save/cancel flow, badge fix
  and scanned/manual rules; the toolbar no longer has a Conditions button or panel.
- [ ] Filter and Search use the Hex Scope field style; Search jumps within the filtered rows and does
  not hide anything.
- [ ] Every button and row action uses the shared primary/secondary/add/danger/nav/act hierarchy.
- [ ] No hard-coded colour, inline style, new dependency or file write is introduced.
- [ ] `npm run check-types`, `npm run lint`, `npm test` and `npm run package` pass.
- [ ] The Extension Development Host check covers tabs, resize, section sashes, search/filter,
  Conditions editing and all button states.

## Out of scope

- Redesigning the diff page into a sidebar.
- Changing search semantics beyond the filtered candidate rule (no regex/case/whole-word modes).
- Persisting search or filter across editor reloads.
- New Conditions semantics beyond the approved edit flow.
- Migrating the diff page's toolbar to the new button system, unless it is a trivial shared-class
  reuse.

## Notes

- Full parity is explicitly requested: include pane sashes and saved heights, not just visual tabs.
- `vscode.setState` replaces Hex Scope's localStorage for tab/width/pane state; the user-visible
  behavior is the same.
- The existing details visibility toggle and saved `inspectorHidden` state are retired in favor of
  tabs.
