# Design: webview runtime and reusable components

## Target tree

```text
src/
├── extension.ts
├── bootWatchdog.ts
├── host/
│   ├── ecucEditorProvider.ts
│   ├── ecucEdit.ts
│   ├── ecucStructureEdit.ts
│   ├── diffPanel.ts
│   └── compareSelection.ts
├── core/
│   ├── ecuc/                 scanner, model, order, syscond, node ids, rows
│   └── diff/                 diffModel, labels
├── webview/
│   ├── editorViewer.ts       editor composition root
│   ├── diffViewer.ts         diff composition root
│   ├── components/
│   │   ├── documentTree/     documentTreeView.ts, documentRows.ts, documentTree.css
│   │   ├── diffView/         diffView.ts, diffViewRender.ts, diffView.css
│   │   ├── toolbar/          toolbar.ts, toolbar.css
│   │   ├── searchBar/        searchBar.ts, searchBar.css
│   │   ├── sidebar/          sidebar.ts + detailsPanel/ + conditionsPanel/ + css
│   │   ├── contextMenu/      contextMenu.ts, contextMenu.css
│   │   └── detailsEditor/    detailsEditor.ts, detailsEditor.css
│   ├── render/               virtualScroll.ts, rowView.ts, rowSearch.ts,
│   │                         treeQuery.ts, html.ts, jsonScript.ts, pageError.ts
│   └── styles/               tokens.css, base.css
└── test/
    ├── core/
    ├── webview/
    │   ├── components/<component-name>.test.ts
    │   └── page/
    └── extension/
```

## Component contract

Follow Hex Scope:

- Every component lives under `src/webview/components/<ComponentName>/`; there is no second
  component root. Nested panels are subfolders of their owning component (for example
  `components/sidebar/detailsPanel/`), not top-level features.
- Component tests are flat under `src/test/webview/components/<component-name>.test.ts`.
- Each component has a spec at `.trellis/spec/frontend/components/component-<name>.md`; the
  template and index are copied from Hex Scope.
- `toHtml()` (or a render module) returns markup; `mount()` attaches listeners idempotently.
- Feedback setters (`setRows`, `setCount`, `setBusy`, `setSelected`) push host data in.
- Constructor options seed UI state; callbacks report user actions.
- Components never read host globals or `vscode`; the composition root passes data and handles effects.
- Component CSS is imported by the component module.

Because this extension renders pages server-side, `esbuild.js` gets a text loader for `.css`:

```js
loader: { '.css': 'text' }
```

Component modules import `styles from './documentTree.css'` and the composition root injects the string into the page's nonce stylesheet. Hex Scope imports CSS for bundling; this loader preserves the same ownership while keeping the existing nonce model.

## Ownership split

- Host: `EcucEditorProvider`, `DiffPanel`, file reads, messages, watchers, edits.
- Core: scanner/model/rows/node ids/diff model/labels — no DOM, no `vscode`.
- Webview: page shells, components, render helpers, styles.

## Migration stages

1. **Stabilize pending fixes** (guide overlap, single vertical bar, split thickness, large-file render cost) and commit.
2. **Skeleton + build loader**: create `webview/styles`, `webview/render`, add CSS text loader, move shared helpers and their tests.
3. **DocumentTree**: move `documentTreeView.ts` + `documentRows.ts` + CSS into `components/documentTree`, update both composition roots.
4. **Editor components**: toolbar, search bar, sidebar (Details/Conditions), details editor, context menu; `renderHtml` becomes `editorViewer.ts`.
5. **Diff components**: `diffPage` becomes `diffViewer.ts`; two-pane surface and toolbar under `components/diffView`.
6. **Host/core split**: move provider/edit/diff-panel to `host`, pure models to `core`; update imports and tests.
7. **Cleanup**: remove old paths, update spec/docs, full gates and boot check.

Each stage is behavior-preserving and independently testable. No stage leaves duplicate live renderers.

## Risks

- CSS text loader affects the extension bundle; verify `dist/extension.js` and the package boot check.
- Page scripts still serialize functions with `toString()`; component modules must keep serializable helpers self-contained.
- Moving tests can hide broken imports; run the full suite after each stage.
- Large path churn should be one stage per component family, not one mega-commit.

## Rollback

Each stage is a commit. Revert the last stage to restore the previous paths; no payload/state changes.
