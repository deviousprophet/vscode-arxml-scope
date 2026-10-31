# Align Trellis frontend specs, docs and examples

## Goal

Mirror Hex Scope's Trellis spec structure and documentation so the two repositories are handled the
same way.

## Requirements

- Frontend spec set: `index.md`, `directory-structure.md`, `component-guidelines.md`,
  `css-guidelines.md`, `type-safety.md`, `testing.md`, `quality-guidelines.md`,
  `state-management.md`, `editor-lifecycle.md`, `hook-guidelines.md`.
- `components/index.md`, `component-template.md` and one spec per component.
- `guides/index.md`, code-reuse thinking guide, cross-layer thinking guide.
- Fill contextMenu and detailsEditor component specs.
- Add `docs/` and `examples/` for the ECUC editor and diff.

## Acceptance

- [ ] Every component has a spec at `.trellis/spec/frontend/components/component-<name>.md`.
- [ ] Frontend spec index matches Hex Scope's set.
- [ ] Guides index and thinking guides exist.
- [ ] Docs/examples exist and are referenced from README.
- [ ] No placeholder sections in component specs.
