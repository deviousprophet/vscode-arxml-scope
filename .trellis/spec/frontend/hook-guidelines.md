# Hook Guidelines

## Overview

Not applicable. There is no web framework in this repository, so there are no React/Vue-style hooks,
no `use*` functions and no data-fetching hook library. The webview is a static HTML shell plus a plain
TypeScript bundle; state lives in module-local variables owned by a composition root.

## What Plays the Hook's Role

| Need | Mechanism |
|---|---|
| Share stateful view logic between components | A component class (`DocumentTreeView`, `Sidebar`, `SearchBar`, `DiffView`) with an explicit `mount()` and setter/paint methods. |
| Share a pure rule between the page and tests | A plain exported function in its owning module (`documentTreeState.ts`, `render/virtualScroll.ts`, `render/rowSearch.ts`, `render/treeQuery.ts`, `detailsPanel.ts`) imported by both the page bundle and the test. |
| Share a host effect | A small module under `src/host/` (`ecucEdit`, `navigation`, `bootWatchdog`, `conditionValues`). |
| Share page state across modules | An explicit host object (`DetailsEditorHost`, `ContextMenuHost`) or callback set defined by the composition root. |

## Rules

- Do not introduce a hook-shaped abstraction (`useX`, a reactive store, an effects queue) without a
  framework that requires it. A plain function or class method is the contract.
- A reusable rule belongs to the lowest layer that can own it: pure ECUC/diff logic in `src/core/`,
  browser helpers in `src/webview/render/`, a component behaviour in its folder.
- A rule that must run identically in the page and the test is exported from its owning module and
  imported by both; do not write a second host-side implementation or copy the function into a test.
- The composition root (`editorViewer.ts` / `diffViewer.ts`) wires data, callbacks and persistence.
  Components never reach for a global hook registry.

## Common Mistakes

| Mistake | Why it fails |
|---|---|
| Wrapping a pure helper in a “hook” | It adds indirection without a framework and hides that the function is an ordinary module export. |
| Keeping a second copy of a view rule in the test | The test then agrees with itself; import the page's own module instead. |
| Fetching data from a component | Data comes from the host through the protocol; components are paint/interaction only. |
