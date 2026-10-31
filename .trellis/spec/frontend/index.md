# Frontend Development Guidelines

> Best practices for the code in this repository: a VS Code extension with a webview-based custom
> editor. There is no web framework — the webview is plain HTML/CSS/JS.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization, layering, and the one-way dependency rule | Filled |
| [Testing Guidelines](./testing.md) | Fixture, assertion and isolation conventions | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Forbidden patterns and the rules every change must keep | Filled |
| [Type Safety](./type-safety.md) | Type ownership, boundaries, protocol and numeric-value rules | Filled |
| [Component Guidelines](./component-guidelines.md) | Webview shell, event ownership, DOM contracts, theme/a11y | Filled |
| [CSS Guidelines](./css-guidelines.md) | File placement, tokens, `data-*` selectors, row/sidebar layout, bundling | Filled |
| [Components](./components/index.md) | Reusable webview component folders, contracts and per-component specs | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks; not applicable — the pages use component classes and imported helpers | Not applicable — no web framework |
| [State Management](./state-management.md) | Host/webview split, re-scan survival, persistence | Filled |
| [Editor Lifecycle](./editor-lifecycle.md) | ECUC editor and diff panel sessions, protocol contracts, error matrix | Filled |

Thinking guides live in [`.trellis/spec/guides/`](../guides/index.md): the
[Code Reuse Thinking Guide](../guides/code-reuse-thinking-guide.md) and the
[Cross-Layer Thinking Guide](../guides/cross-layer-thinking-guide.md).

---

## Maintaining These Guidelines

For each guideline file:

1. Document this project's **actual conventions** (not ideals).
2. Include **code examples** from this codebase.
3. List **forbidden patterns** and why.
4. Add **common mistakes** already made here.

A command, path or type named in a guide must exist in the current tree. If a guide and the source
disagree, the source wins and the guide is corrected in the same change.

---

**Language**: All documentation should be written in **English**.
