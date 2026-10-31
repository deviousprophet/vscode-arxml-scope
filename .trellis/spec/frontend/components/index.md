# Webview Components

Every component lives under `src/webview/components/<ComponentName>/` and owns its markup,
transient UI state, input behaviour and `<ComponentName>.css`. Hosts own data, domain rules and
provider messages. Component tests are flat under `src/test/webview/components/`.

| Component | Source | Spec |
|---|---|---|
| DocumentTreeView | `src/webview/components/documentTree/` | [component-document-tree.md](./component-document-tree.md) |
| DiffView | `src/webview/components/diffView/` | [component-diff-view.md](./component-diff-view.md) |
| Toolbar | `src/webview/components/toolbar/` | [component-toolbar.md](./component-toolbar.md) |
| SearchBar | `src/webview/components/searchBar/` | [component-search-bar.md](./component-search-bar.md) |
| Sidebar | `src/webview/components/sidebar/` | [component-sidebar.md](./component-sidebar.md) |
| ContextMenu | `src/webview/components/contextMenu/` | to fill during extraction |
| DetailsEditor | `src/webview/components/detailsEditor/` | to fill during extraction |

New component specs start from [component-template.md](./component-template.md).
