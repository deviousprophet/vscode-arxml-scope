# Hex Scope UI reference (sidebar, search, buttons)

Source: `D:\workspace\vscode-hex-scope` (read-only sibling extension). The goal is visual and
interaction parity, adapted to this extension's two panels and VS Code theme tokens.

## Sidebar shell

- `src/webview/components/sidebar/sidebar.ts:107-123` — `Sidebar.toHtml()` renders, in order:
  `#sidebar-resizer`, `#sidebar` (tab panels + optional common-settings slot), then `#side-tabs`
  (one `.stab` button per panel). The tab strip is the right edge; panels are to its left.
- `sidebar.ts:99-104,141-155` — active tab is a class on `.stab` and `.sb-tab-panel`; the host can
  lazily mount a panel on activation.
- `sidebar.css:151-182` — `#side-tabs` is a 28px vertical strip; `.stab` uses `writing-mode:
  vertical-rl`, 10px bold uppercase, letter-spacing .12em, a transparent 3px right border, hover
  background and an active right-border accent. `.sb-tab-panel` is `display:none` until `.active`.
- `sidebar.css:20-25` — `#sidebar` uses `--sidebar-w` (default 360px), `min-width`, a left border and
  a column flex layout. `#sidebar-resizer` is a 6px column with a hover/drag accent
  (`sidebar.css:3-18`).
- `sidebar.ts:42-64,166-221` — width persists in localStorage under `hexScope.sidebarWidth`, clamped
  260–900px, and the resizer supports drag plus ArrowLeft/ArrowRight.

## Sections and panes

- `sidebar.ts:393-858` — `SidebarSections` is the full section/pane model:
  - each section is a 22px header (`role=button`, `aria-expanded`, `aria-controls`) with a
    decorative chevron and optional header actions;
  - bodies scroll independently (`role=region`, `aria-labelledby`);
  - sections are panes with `flex-basis` sizing, a 6px `role=separator` sash between them, drag,
    ArrowUp/ArrowDown, double-click reset, and saved heights;
  - allocation keeps a `MIN_PANE` (header + 60px), distributes free space, restores saved sizes and
    lets a single expanded pane fill the panel;
  - collapse/expand animates 150ms, except during resize; reduced-motion disables it.
- `sidebar.css:41-85,99-149` — pane-view, 22px header, uppercase 11px bold label, chevron rotation,
  section action slot, sash styling and focus outlines.
- Tab panels must be flex columns; `.sb-tab-panel > div` fills the panel so a pane view's `flex:1`
  resolves (`sidebar.css:171-182`).

## Search bar

- `src/webview/components/searchBar/searchBar.ts:44-63` — markup: `#search-box` contains an input,
  a search button, previous/next, clear, a progress slot and `#match-count`.
- `searchBar.css:1-82` — `#search-input` is 26px high, 180px wide (min 70), input-background/border,
  3px radius, editor font 12px; focus border. `#search-box` is a right-aligned flex row with 3px gap.
- `.nav-btn` is 28×28 (prev/next 30×26), transparent, 4px radius, hover background + border.
  `#btn-clear-search` is 24×24. `#match-count` is 14ch, right-aligned, tabular numerals.
- `searchBar.ts:135-153` — Enter runs next/previous (Shift+Enter previous), Ctrl/Cmd+F focuses the
  input, Escape/clear clears the query. Count text is `current + 1 / count`, `0 / 0` for a query
  with no matches, empty for no query.

## Buttons and actions

- `src/webview/styles/base.css:189-217` — `.sb-btn` base: inline-flex, 4px gap, 3px radius, 10px 600
  UI font, 2px 8px padding, nowrap, transition. Variants:
  - `.sb-btn-primary` — `--btn-bg` / `--btn-fg`, hover `--btn-hover`;
  - `.sb-btn-secondary` — transparent, `--addr-fg`, 1px `--border`; hover foreground + border;
  - `.sb-btn-danger` — red-tinted background/border; hover stronger;
  - `.sb-btn-add` — transparent accent text, 1px dashed accent border; hover soft background and
    solid border;
  - `.sb-btn:disabled` — opacity .35, `cursor:not-allowed`.
- `base.css:236-260` — `.act-btn` is an 18×18 icon action, transparent, 2px radius, muted, hidden
  (opacity 0) until its parent row/card is hovered or focused; edit hovers accent, delete hovers
  error. This is the per-row Edit/Delete pattern.
- Hex Scope's presence UI uses `.sb-btn-primary` Save + `.sb-btn-secondary` Cancel
  (`overlayPanel.ts:733-734,990-991`) and `.act-btn-edit` pencil / `.act-btn-del` trash
  (`overlayPanel.ts:3076-3078`).
- `searchBar.css:39-57` `.nav-btn` is the canonical icon-button style for the toolbar/search area.

## Token mapping for ARXML Scope

Use VS Code theme variables directly; do not copy the rgba/hex literals.

| Hex Scope token | ARXML Scope token |
|---|---|
| `--bg` | `--vscode-editor-background` |
| `--fg` | `--vscode-editor-foreground` |
| `--border` | `--vscode-panel-border` / `--vscode-editorGroup-border` |
| `--panel-bg` | `--vscode-sideBar-background` |
| `--input-bg/fg/bdr` | `--vscode-input-background/foreground/border` |
| `--focus-bdr` | `--vscode-focusBorder` |
| `--btn-bg/fg/hover` | `--vscode-button-background/foreground/hoverBackground` |
| `--hover-bg` | `--vscode-list-hoverBackground` |
| `--addr-fg` | `--vscode-descriptionForeground` |
| `--high-color` | `--vscode-textLink-foreground` / `--vscode-focusBorder` |
| `--err` | `--vscode-errorForeground` |

## Deliberate adaptations

- Persist tab, sidebar width and pane heights through `vscode.setState` (the existing webview state
  mechanism) instead of localStorage; behavior stays the same per panel.
- Add proper `role=tablist` / `role=tab` / `aria-selected` semantics to the tab strip (Hex Scope uses
  buttons and classes only).
- The Details and Conditions panels are the only two tabs; the full pane/section machinery is kept.
- The diff page is out of scope for the sidebar; only shared button tokens may be reused if trivial.
