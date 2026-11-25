# Implementation plan — collapsed marker semantics and view-zone gap

- [x] Extend `diffFoldIndicator.test.ts` with name-only root/descendant and substantive cases.
- [x] Filter the root row in `diffFoldIndicator.ts`.
- [x] Centre the glyph dot in `monaco.css`.
- [x] Add a shared-module/one-sided-child preview fixture.
- [x] Add `diff-collapsed-onesided` and record diagonal-fill counts.
- [x] Patch the four side-by-side `createFakeLinesDiv()` zones in `diffEditorViewZones.js`.
- [x] Regenerate the patch from the pristine 0.57.0 tarball and verify it applies.
- [x] Add `diffEditorViewZones.js` to the pinned hashes and patch assertions.
- [x] Verify the new state has zero visible diagonal fills while folded and native fills when expanded.
- [x] Run focused tests and preview states.
- [x] Full gates: types, lint, tests, preview set, fallow, production, `git diff --check`.
- [ ] Commit, push and check CI.

## Evidence

- Marker rule: name-only root rename is ignored; a descendant value change or rename still marks
  the collapsed row. `diffFoldIndicator.test.ts` has 5 passing cases.
- `diff-collapsed-onesided` records visible `.diagonal-fill` counts
  `{ modified: 0, original: 0 }` while folded, `{ 1, 0 }` after expansion, and `{ 0, 0 }` after
  the reverse fold. The expanded count is one-sided, as expected.
- The marker dot is a 6px centered glyph-margin pseudo-element; no text or count.
- `patches/monaco-editor+0.57.0.patch` has a fourth file hunk for `diffEditorViewZones.js`.
  `patch-package`'s temporary install failed offline, so the hunk was generated against the
  pristine `monaco-editor@0.57.0` npm tarball and checked with `git apply --check` (exit 0).
- Pinned hash: `diffEditorViewZones.js` = `ca5771457cad0f06ffd6a8ae0d3b10ec2d72bf43ae7e961523866f029d94ea91`.
  `diffCodeParity.test.ts` passes its hash and patch assertions.
- Full preview set: 40 states, `failed: 0`.
- 925 tests passing; types, lint, fallow (dead-code 0, complexity 0, duplication 0), production
  bundle and `git diff --check` pass.
