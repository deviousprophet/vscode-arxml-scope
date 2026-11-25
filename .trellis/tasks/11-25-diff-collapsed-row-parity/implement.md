# Implementation plan — collapsed diff row parity

- [x] Add the failing fold-start assertion to `syntheticDocument.test.ts`.
- [x] Change `openSideBlock` to use the node line from `rowLine`.
- [x] Verify normal, one-sided and empty-container cases.
- [x] Add `diff-collapsed` to `previewData.ts` and the folded-line probe to `previewPage.ts`.
- [x] Add the audit violation for a `{`-only collapsed header.
- [x] Run focused synthetic/preview checks.
- [ ] Full gates and preview set.
- [ ] Commit the child and record the commit in the parent.

## Evidence

Before the fix, the new assertion failed with `fold range for module:removed#0 starts on its
node line 1 !== 2`: the range started on the opening brace.

`openSideBlock` now reads the node line from `rowLine` and keeps the brace lines inside the
range. The synthetic suite passes 19/19.

`diff-collapsed` folds `Items` on the modified pane. The audit records visible lines
`module P.Preview "Preview"`, `{`, `Items "Items"`, `}` and fold hint `"⋯"`; `P0000` is
hidden. Before the fix the fold command found no region at the node line.

The full parent gates and seeded set run after the sync and sticky children.
