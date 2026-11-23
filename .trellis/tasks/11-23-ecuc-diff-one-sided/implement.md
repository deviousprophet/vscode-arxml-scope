# Implementation plan — one-sided diff placeholders

## Phase 0 — Red test

- [ ] Add a `buildAlignedSyntheticDocuments` test with:
  - a left-only container with children;
  - a right-only module/container;
  - a shared row.
- [ ] Assert the missing side has no `{`/`}` for the one-sided rows and both sides have equal
      line counts.
- [ ] Add a preview audit assertion that fails on the current fake braces.

## Phase 1 — Aligned document fix

- [ ] In `buildAlignedSyntheticDocuments`, emit opening/closing braces only when the row exists
      on that side; use `''` for the missing side.
- [ ] Keep one line per display row so keys/line counts stay aligned.
- [ ] Keep folding ranges side-specific.
- [ ] Verify children of a one-sided container stay blank on the missing side.

## Phase 2 — Placeholder fill

- [ ] Add `arxml-diff-placeholder` decorations on the missing side for one-sided rows.
- [ ] CSS neutralizes Monaco's inserted/deleted line background for the placeholder; verify the
      gutter/line number if visible.
- [ ] Do not neutralize the real side's change fill.
- [ ] Keep selection/merge arrows targeting the real side; skip or mark the placeholder side.

## Phase 3 — Preview/audit

- [ ] Add `oneSidedPair` fixture: left-only module/container, right-only module/container,
      shared rows, children/parameters.
- [ ] Add `diff-one-sided` state.
- [ ] Audit the actual aligned models:
  - [ ] equal line counts;
  - [ ] no `{`/`}` on the missing side;
  - [ ] neutral placeholder class/background;
  - [ ] real side still has node/braces;
  - [ ] expected added/removed changes and navigation.
- [ ] Add screenshot/docs row.

## Phase 4 — Manual sample check

- [ ] Open the local `sample_edge.arxml` vs `sample_diff.arxml`.
- [ ] Check `RemovedMod`, `SharedContainerDef "Inner"`, `AddedContainer`, `DiffExtraMod`,
      `RenamedModOld/New`, `EmptyDef`/`MissingDef`.
- [ ] Confirm no fake `{ }` and no green empty placeholder.
- [ ] Do not copy the sample into the repo.

## Phase 5 — Verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] Focused aligned-document/diff tests
- [ ] `npm test --ignore-scripts`
- [ ] `npm run shots:webview`
- [ ] `node esbuild.js --production`
- [ ] `git diff --check`

## Review gates

- [ ] One-sided containers/modules have blank missing-side lines, no braces.
- [ ] Missing-side placeholder is neutral, not a green/red content line.
- [ ] Line counts, folding, keys, selection, navigation and merge arrows remain correct.
- [ ] The `diff-one-sided` audit fails on fake braces and passes after the fix.
- [ ] Local sample pair is visually correct.
- [ ] Full suite, preview audit and production bundle pass.

## Rollback

- [ ] Revert the brace guards, placeholder class/CSS, fixture/state/audit. No data/protocol
      change.
