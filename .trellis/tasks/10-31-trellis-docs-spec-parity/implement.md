# Implementation plan

1. Read the Hex Scope headings for `css-guidelines.md`, `editor-lifecycle.md`, `type-safety.md`, then
   read this repo's actual CSS, provider, protocol and diff code.
2. Write `css-guidelines.md` with real ECUC selectors, tokens, CSP/no-inline-style rules, bundling
   and the test-side CSS hook.
3. Write `editor-lifecycle.md` as two 7-section scenarios (ECUC editor, diff panel) with the real
   signatures and error matrix.
4. Replace `type-safety.md` placeholders with the type-ownership, boundary, protocol, numeric-value,
   forbidden-pattern and verification sections.
5. Update `index.md` (CSS + editor lifecycle rows, Type Safety status, guides link) and
   `components/index.md` (every component, no "to fill" rows).
6. Add `docs/README.md`, `docs/ECUC_EDITOR.md`, `docs/DIFF.md`, `examples/README.md` and
   `examples/synthetic-ecuc.arxml`; link them from the root `README.md`.
7. Update the parent `blind-copy-audit.md` findings that this child resolves; leave unrelated history.
8. Verify: every component folder has a spec; every spec is indexed; no `To fill`/placeholder text;
   every link target exists; the audit grep has no unresolved hex-only reference.
9. Commit the docs/spec change set.

## Validation commands

- Component/spec inventory check (PowerShell or Node).
- `Select-String`/`grep` for `To fill`, `(To be filled`, `hexscope`, `hexView`, `intelHex`, `srec`.
- Markdown link check for the new docs and README links.
- `npm run check-types` and `npm run lint` (no code change, but confirm the tree is still green).

## Rollback

Docs-only; revert the commit.
