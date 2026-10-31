# Design: spec and docs parity

## Spec tree

```text
.trellis/spec/frontend/
├── index.md
├── directory-structure.md
├── component-guidelines.md
├── css-guidelines.md
├── type-safety.md
├── testing.md
├── quality-guidelines.md
├── state-management.md
├── editor-lifecycle.md
├── hook-guidelines.md
├── components/
│   ├── index.md
│   ├── component-template.md
│   ├── component-document-tree.md
│   ├── component-diff-view.md
│   ├── component-toolbar.md
│   ├── component-search-bar.md
│   ├── component-sidebar.md
│   ├── component-context-menu.md
│   └── component-details-editor.md
└── guides/
    ├── index.md
    ├── code-reuse-thinking-guide.md
    └── cross-layer-thinking-guide.md
```

## Rules

- Copy Hex Scope's rule structure, not its hex-specific examples.
- Component specs follow the template: scope, layout, contract, rules, behaviour, validation matrix,
  tests, anti-patterns.
- Docs describe ECUC editor/diff usage; examples are synthetic ARXML samples.
- Update the frontend index table to include every spec.

## Rollback

Docs-only child; revert the commit.
