# Implementation plan — collapsed diff row parity

- [ ] Add the failing fold-start assertion to `syntheticDocument.test.ts`.
- [ ] Change `openSideBlock` to use the node line from `rowLine`.
- [ ] Verify normal, one-sided and empty-container cases.
- [ ] Add `diff-collapsed` to `previewData.ts` and the folded-line probe to `previewPage.ts`.
- [ ] Add the audit violation for a `{`-only collapsed header.
- [ ] Run focused synthetic/preview checks.
- [ ] Full gates and preview set.
- [ ] Commit the child and record the commit in the parent.
