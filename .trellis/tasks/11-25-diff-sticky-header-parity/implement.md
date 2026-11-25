# Implementation plan — diff sticky-header parity

- [x] Confirm the node-start fold ranges from the collapsed-row child.
- [x] Add the editor parity options to both inner editors.
- [x] Add the diff `scrollLine` handling and a `diff-sticky` state.
- [x] Record sticky text and compare it with the expected node header.
- [x] Add the audit violation for `{`-only or empty sticky text.
- [x] Capture `diff-sticky` and inspect the PNG.
- [x] Full gates and preview set. (920 tests, 39 preview states)
- [ ] Commit the child and record the commit in the parent.

## Evidence

The first attempt enabled `stickyScroll` with `foldingProviderModel` but the sticky widget stayed empty.
The sticky controller was installed, its folding model had the node-start regions, but
`getCandidateStickyLinesIntersecting` returned no candidates.

The editor already documents the cause: Monaco converts a folding end to `end + 1`, and a
document ending on `}` makes the outermost scope invalid, dropping every candidate. The editor
appends one trailing newline; the diff synthetic documents did not. Both diff documents now end
with one trailing newline and their line-key arrays have the matching final undefined entry.

`diff-sticky` records `13module P.Preview "Preview" Items "Items"` at height 38, with the full
module and container headers instead of `{`. The synthetic suite also asserts the trailing
newline and passes 19/19.

The full seeded set (39 states) passes; product tests run in the parent integration.
