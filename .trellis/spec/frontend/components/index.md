# Webview Components

Every top-level component lives under `src/webview/components/<ComponentName>/`; the two nested
sidebar panels live under `src/webview/components/sidebar/`. Each component owns its markup, transient
UI state, input behaviour and `<component>.css`. Hosts own data, domain rules and provider messages.
Component tests are flat under `src/test/webview/components/`.

| Component | Source | Spec |
|---|---|---|
| DocumentTreeView | `src/webview/components/documentTree/` | [component-document-tree.md](./component-document-tree.md) |
| DiffView | `src/webview/components/diffView/` | [component-diff-view.md](./component-diff-view.md) |
| Toolbar | `src/webview/components/toolbar/` | [component-toolbar.md](./component-toolbar.md) |
| SearchBar | `src/webview/components/searchBar/` | [component-search-bar.md](./component-search-bar.md) |
| Sidebar | `src/webview/components/sidebar/` | [component-sidebar.md](./component-sidebar.md) |
| Sidebar ConditionsPanel | `src/webview/components/sidebar/conditionsPanel/` | [component-sidebar-conditions-panel.md](./component-sidebar-conditions-panel.md) |
| Sidebar DetailsPanel | `src/webview/components/sidebar/detailsPanel/` | [component-sidebar-details-panel.md](./component-sidebar-details-panel.md) |
| ContextMenu | `src/webview/components/contextMenu/` | [component-context-menu.md](./component-context-menu.md) |
| DetailsEditor | `src/webview/components/detailsEditor/` | [component-details-editor.md](./component-details-editor.md) |

New component specs start from [component-template.md](./component-template.md). The template's
`<ComponentName>` placeholders are intentional; a real component spec replaces every section with its
own names, signatures and behaviour table.
