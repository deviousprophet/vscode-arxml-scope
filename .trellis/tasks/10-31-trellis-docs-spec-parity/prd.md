# Align Trellis frontend specs, docs and examples

## Goal

Mirror Hex Scope's Trellis frontend spec structure and documentation, adapted to ECUC, and document
the ECUC editor/diff for users with real synthetic ARXML examples.

## Requirements

- Frontend spec set: `index.md`, `directory-structure.md`, `component-guidelines.md`,
  `css-guidelines.md`, `type-safety.md`, `testing.md`, `quality-guidelines.md`,
  `state-management.md`, `editor-lifecycle.md`, `hook-guidelines.md`.
- `components/index.md`, `component-template.md` and one spec per component folder.
- `guides/index.md`, code-reuse thinking guide and cross-layer thinking guide (verify the existing
  files still match the Hex structure).
- Replace the placeholder `type-safety.md`; add `css-guidelines.md` and `editor-lifecycle.md` with
  ECUC-specific contracts and examples.
- Add `docs/` and `examples/` for the ECUC editor and diff, using synthetic ARXML only; link them
  from the root `README.md`.
- Adapt, never copy: no hex parser/memory/overlay/profile/scripting terminology, examples or assets.
- Resolve the stale spec findings recorded in the parent `blind-copy-audit.md`.

## Acceptance

- [ ] Every `src/webview/components/<Name>/` has a spec at
      `.trellis/spec/frontend/components/component-<kebab>.md` and is listed in `components/index.md`.
- [ ] The frontend spec index lists every spec file; no `To fill` rows or placeholder sections.
- [ ] `css-guidelines.md` and `editor-lifecycle.md` exist and describe this repo's real contracts.
- [ ] `type-safety.md` contains real type ownership, boundary, protocol and forbidden-pattern rules.
- [ ] `guides/index.md` and both thinking guides exist and are indexed.
- [ ] `docs/` and `examples/` exist with real ECUC content and are linked from `README.md`.
- [ ] The blind-copy audit has no unresolved hex-only reference, missing path or empty copied tree.
- [ ] Every example/document uses ARXML/ECUC content, never hex dumps or hex terminology.
