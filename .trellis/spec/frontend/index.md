# Frontend Development Guidelines

> Best practices for the code in this repository: a VS Code extension with a webview custom
> editor and a Monaco-based semantic diff. The pages are plain HTML/CSS/JS with no web
> framework; `monaco-editor` is bundled and pinned.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization, layering, and the one-way dependency rule | Filled |
| [Testing Guidelines](./testing.md) | Fixture, assertion, gate and preview-execution conventions | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Forbidden patterns and the rules every change must keep | Filled |
| [Type Safety](./type-safety.md) | Type ownership, boundaries, protocol and numeric-value rules | Filled |
| [Component Guidelines](./component-guidelines.md) | Webview shell, event ownership, DOM contracts, theme/a11y | Filled |
| [CSS Guidelines](./css-guidelines.md) | File placement, tokens, `data-*` selectors, row/sidebar layout, bundling | Filled |
| [Components](./components/index.md) | Reusable webview component folders, contracts and per-component specs | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks; not applicable — the pages use component classes and imported helpers | Not applicable — no web framework |
| [State Management](./state-management.md) | Host/webview split, re-scan survival, persistence | Filled |
| [Editor Lifecycle](./editor-lifecycle.md) | ECUC editor and diff panel sessions, protocol contracts, error matrix | Filled |
| [Monaco](./monaco.md) | Synthetic ECUC documents, native find bridge, diff editor ownership, gutter actions, the intentional folding deviation | Filled |
| [Diff Matching](./diff-matching.md) | Semantic rename pairing: candidate blocking, scores, deterministic budget, fallback, benchmark guards | Filled |
| [Diff Parity](./diff-parity.md) | Pinned VS Code/Monaco release, upstream hashes, checked-in patch and ARXML adapters | Filled |
| [Preview Audit](./preview-audit.md) | Webview preview execution rules, rendered-geometry invariants and proof boundaries | Filled |

Thinking guides live in [`.trellis/spec/guides/`](../guides/index.md): the
[Code Reuse Thinking Guide](../guides/code-reuse-thinking-guide.md),
the [Cross-Layer Thinking Guide](../guides/cross-layer-thinking-guide.md) and the
[Documentation Architecture Guide](../guides/documentation-architecture-guide.md).

---

## Related Docs

| Audience | Page |
|---|---|
| Documentation index (users and contributors) | [`docs/README.md`](../../../docs/README.md) |
| User guides (ECUC editor, diff, merge) | [`docs/user/ECUC_EDITOR.md`](../../../docs/user/ECUC_EDITOR.md) — the index links diff and merge |
| Contributor setup, tests, preview and engine | [`docs/contributor/DEVELOPMENT.md`](../../../docs/contributor/DEVELOPMENT.md) |
| Webview preview state table and limits | [`docs/contributor/WEBVIEW_PREVIEW.md`](../../../docs/contributor/WEBVIEW_PREVIEW.md) |
| Webview visual identity and design tokens | [`DESIGN.md`](../../../DESIGN.md) |
| Rust engine protocol and crate layout | [`rust/README.md`](../../../rust/README.md) |

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
