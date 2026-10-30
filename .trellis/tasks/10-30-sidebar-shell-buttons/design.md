# Sidebar shell — technical design

## 1. DOM

```html
<div id="content">
  <div id="main">…tree…</div>
  <div id="sidebar-resizer" role="separator" aria-orientation="vertical"
       aria-label="Resize sidebar" tabindex="0"></div>
  <aside id="sidebar" aria-label="ECUC sidebar">
    <div id="sbp-details" class="sb-tab-panel active" role="tabpanel" aria-labelledby="stab-details">
      <div id="inspector" class="inspector" role="region" aria-label="Node details">
        <section class="sb-section sb-pane" id="sb-details-node">
          <div class="sb-section-head" role="button" aria-expanded="true" aria-controls="sb-details-node-body">
            <span class="sb-section-chevron" aria-hidden="true"></span>
            <h3 class="sb-section-title"><span class="sb-section-label">Node</span></h3>
          </div>
          <div class="sb-body" id="sb-details-node-body" role="region" aria-labelledby="…"></div>
        </section>
        … Value, Reference, Conditions & annotations …
      </div>
    </div>
    <div id="sbp-conditions" class="sb-tab-panel" role="tabpanel" aria-labelledby="stab-conditions" hidden>
      <section class="sb-section sb-pane" id="sb-conditions-values">
        <div class="sb-section-head" role="button" …>…Condition values…</div>
        <div class="sb-body" id="sb-conditions-values-body" role="region">
          <div id="conditions-panel" class="conditions-panel">…existing table…</div>
        </div>
      </section>
    </div>
  </aside>
  <div id="side-tabs" role="tablist" aria-label="Editor sidebar" aria-orientation="vertical">
    <button id="stab-details" class="stab active" role="tab" aria-selected="true"
            aria-controls="sbp-details">Details</button>
    <button id="stab-conditions" class="stab" role="tab" aria-selected="false"
            aria-controls="sbp-conditions">Conditions</button>
  </div>
</div>
```

Sashes (`<div class="sb-pane-sash" role="separator" aria-orientation="horizontal" tabindex="0">`)
are inserted between sections. The Conditions tab keeps its panel internals; child 2 rewrites the
body later.

## 2. Shell script (`src/editor/sidebarShell.ts`)

Keep the page logic out of `TREE_SCRIPT`. Export:

```ts
export interface PaneSpec { id: string; saved: number | null; collapsed: boolean; user: boolean }

export function clampSidebarWidth(width: number, viewport: number, tabsWidth: number): number;
export function allocatePanes(free: number, panes: readonly PaneSpec[]): Map<string, number>;
export function sidebarShellScript(): string; // tabs + resizer + sections/sashes + persistence
```

- `allocatePanes` is pure and unit-tested: `HEADER_H=22`, `MIN_PANE=82`, `SASH_H=6`; one expanded
  pane fills; saved user sizes first; fresh panes share; last absorbs rounding.
- `sidebarShellScript()` emits page functions/classes using only `document`, `window`,
  `ResizeObserver`, `requestAnimationFrame`, `vscode`, and the page's `uiState`/`persistUiState`.
  It is injected into the page before `TREE_SCRIPT`; `mountSidebarShell()` is called at boot after
  `uiState` is initialized.
- Shell responsibilities:
  - tab click + `active` classes, `aria-selected`, panel `hidden`;
  - width drag/resizer + ArrowLeft/ArrowRight; update a CSS custom property and persist;
  - section header click/keyboard; collapse/expand;
  - sash drag/keyboard/double-click; disabled state for collapsed neighbors;
  - `ResizeObserver` on each pane view to re-layout;
  - write `uiState.tab`, `uiState.sidebarWidth`, `uiState.panes`, `uiState.collapsed` and call
    `persistUiState()`.
- The shell does not know about ECUC rows, filter, search or Conditions semantics.

## 3. State

`TREE_SCRIPT` persists one object through `vscode.setState`:

```js
uiState = {
  tab: 'details' | 'conditions',
  sidebarWidth: 360,
  panes: { 'sb-details-node': 120, ... },
  collapsed: ['sb-details-reference'] // section ids
}
```

- `loadUiState(saved)` clamps/ignores invalid values. Missing fields use defaults; a legacy
  `inspectorHidden` is ignored and not written back.
- The shell reads `uiState` at mount and writes on every user change.
- A document re-scan (`setRows`) never modifies `uiState`.
- The host has no new message; all layout state is page-local.

## 4. Details migration

`updateInspector` keeps its selection lookup but targets stable section bodies:

| Section | Body id | Content |
|---|---|---|
| Node | `sb-details-node-body` | kind, label, definition ref, short name, variant, type |
| Value | `sb-details-value-body` | details value input, formats |
| Reference | `sb-details-reference-body` | target, context, Jump to target |
| Conditions & annotations | `sb-details-conditions-body` | condition state/reason, annotations, Reveal in source |

- The four bodies are never removed by `updateInspector`; it clears only each body's content.
- `#inspector` remains the root, so selection/reveal tests keep their anchor.
- `detailsValueInput` and `detailsContainerFields` take the target body as their parent. The details
  editor event ownership is unchanged.
- Empty bodies show a `.sb-empty` line; headers remain interactive.
- The toolbar `#details-toggle` and `uiState.inspectorHidden` code are removed.

## 5. Conditions tab placement

- Move the existing `#conditions-panel` block into `sb-conditions-values-body`; it no longer starts
  `hidden` (the tab panel controls visibility).
- Remove `#conditions-toggle`, `conditionsOpen`, `applyConditionsVisibility` and the toolbar button.
- The current Conditions internals remain until child 2 rewrites them. This child must not change
  the badge/edit behavior.
- Tab switching never auto-selects Conditions.

## 6. Buttons and fields

Add one CSS block near the top of `STYLE` (before component styles):

```css
.sb-btn { display:inline-flex; align-items:center; gap:4px; border-radius:3px;
  font-family:var(--vscode-font-family); font-size:10px; font-weight:600; padding:2px 8px;
  cursor:pointer; white-space:nowrap; user-select:none; }
.sb-btn-primary { background:var(--vscode-button-background); color:var(--vscode-button-foreground);
  border:1px solid transparent; }
.sb-btn-primary:hover { background:var(--vscode-button-hoverBackground); }
.sb-btn-secondary { background:transparent; color:var(--vscode-descriptionForeground);
  border:1px solid var(--vscode-panel-border,var(--vscode-editorGroup-border)); }
.sb-btn-secondary:hover { color:var(--vscode-foreground); border-color:currentColor; }
.sb-btn-add { background:transparent; color:var(--vscode-textLink-foreground);
  border:1px dashed var(--vscode-panel-border,var(--vscode-editorGroup-border)); }
.sb-btn-danger { background:transparent; color:var(--vscode-errorForeground);
  border:1px solid var(--vscode-inputValidation-errorBorder,var(--vscode-errorForeground)); }
.sb-btn:disabled { opacity:.35; cursor:not-allowed; }
.nav-btn { width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center;
  background:transparent; color:var(--vscode-foreground); border:1px solid transparent;
  border-radius:4px; cursor:pointer; }
.nav-btn:hover { background:var(--vscode-list-hoverBackground); border-color:var(--vscode-panel-border); }
.act-btn { width:18px; height:18px; ... opacity:0; }
.parent:hover .act-btn, .parent:focus-within .act-btn { opacity:1; }
```

Fields:

```css
.filter, .search-input { height:26px; padding:0 7px; min-width:70px; width:180px;
  background:var(--vscode-input-background); color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border,var(--vscode-panel-border)); border-radius:3px;
  font:12px var(--vscode-editor-font-family, monospace); }
.filter:focus, .search-input:focus { border-color:var(--vscode-focusBorder); }
```

- Update toolbar Collapse/Expand to `.sb-btn-secondary` (labels) or `.nav-btn` (compact); the
  inspector Jump/Reveal to `.sb-btn-secondary`; empty clear to `.sb-btn-secondary`.
- Keep the custom filter clear X; suppress native search cancel globally for `input[type=search]`.
- Child 2 will convert the Conditions actions to `.sb-btn-primary` / `.sb-btn-secondary` /
  `.act-btn`; child 3 will add the Search field with the same classes.

## 7. Tests

- `src/test/editor/sidebarShell.test.ts`:
  - `clampSidebarWidth` bounds; `allocatePanes` single pane, even split, saved sizes, rounding, min.
  - Shell markup: tab roles/labels, panels, four details sections, Conditions section/sash, resizer.
  - Tab switching source/behavior; no toolbar toggles.
  - Section keyboard/collapse/sash disabled/reset; state persistence shape.
- Update `uxDocument*` / `a11y` / `virtualPage` tests for the section bodies and removed toggles.
- Add a boot-check assertion for the sidebar script, plus the production gate.
- Button/field CSS assertions for the variants and token usage.

## 8. Trade-offs

- **Full pane parity** is more code than a simple accordion; it is explicitly requested and is
  isolated in one module.
- **`vscode.setState` instead of localStorage** keeps the webview state mechanism consistent; the
  user-visible persistence is equivalent.
- **Static section shells** are easier to test and keep the headers stable while `updateInspector`
  rewrites bodies.
- **No auto-switch to Conditions** keeps the selected tab a user decision.
