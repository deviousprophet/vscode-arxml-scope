# Close the PR 42 review findings

## Goal

Fix every actionable finding from the two-axis review of `feat/ecuc-diff-vscode-gutter`
against `main`, and make the `[Unreleased]` changelog describe the net user-visible
difference from `v0.10.0` rather than the development history.

## Requirements

### Standards

- Update `.trellis/spec/frontend/css-guidelines.md` and
  `component-guidelines.md` so they describe the shipped Monaco diff surface and
  `buildDiffSyntheticDocuments`, not the deleted `.diff-row`/placeholder/arrow DOM.
- Remove the `arxml-diff-merge` mirroring class; expose Merge through a non-class
  attribute and update the CSS/audit selector.
- Delete the dead legacy gestures: F7 must target the Monaco diff host, and the preview
  audit must stop measuring `.diff-pane`, `.diff-row`, `.diff-copy-arrow`,
  `.arxml-diff-placeholder` and `.arxml-merge-arrow`.
- Rename or reframe `diffCodeParity.test.ts` as an explicit source-contract test, not a
  behavioural test.
- Remove the legacy `buildAlignedSyntheticDocuments` builder and its tests; keep only
  `buildDiffSyntheticDocuments`.
- De-duplicate the gutter availability lookup, import `DiffGutterMapping`/
  `DiffGutterRange` instead of re-spelling them, rename the readiness check, remove the
  unused `selectedKey`, and separate the production patch global from the preview
  snapshot.
- Update `directory-structure.md`/`testing.md` stale file and preview paths.

### Spec

- Add hover/current-hunk proof and per-item rendered action labels.
- Open and audit the “More Actions…” overflow submenu.
- Run the sash probe in a non-Merge state and through Swap.
- Measure folding on both panes.
- Set `lineNumbersMinChars: 3` and `lineDecorationsWidth: 14` on the diff editor.
- Extract the hunk-to-row helpers into `src/webview/monaco/diffBody.ts`.
- Remove or document `renderMarginRevertIcon`; the archived design must not contradict
  the code.
- Record the accepted scoped-context patch in the archived PRD/design.
- Make the one-sided/Merge audit check the rendered toolbar, not only the self-produced
  availability snapshot.

### Changelog

- Rewrite `[Unreleased]` from the net `v0.10.0..HEAD` user-visible outcomes.
- Fold or drop Fixed bullets that are fixes to features introduced in the same range.
- Keep the header, section order, no terminal periods, no PR/hash references, and all
  package versions at `0.10.0`.

## Acceptance

- [x] No stale `.diff-pane`/placeholder/arrow selectors remain in the preview audit.
- [x] Hover, overflow, both-pane folding, non-Merge sash and Swap sash are exercised.
- [x] Rendered per-item action labels prove one-sided availability.
- [x] `buildAlignedSyntheticDocuments` and its tests are gone.
- [x] `diffBody.ts` owns the hunk mapping.
- [x] Frontend specs match the Monaco surface.
- [x] Changelog has no in-range dev-noise.
- [x] `check-types`, `lint`, tests, preview, fallow, production and CI pass.
