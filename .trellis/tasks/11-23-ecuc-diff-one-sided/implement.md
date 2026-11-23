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

## Result

One-sided diff fix implemented and checked on 2026-11-23.

- `buildAlignedSyntheticDocuments` emits braces only on the side that owns the row; the missing
  side keeps equal-length blank lines. Keys, rowLine, folding, selection and line counts stay
  aligned.
- `diffMonaco` marks every missing-side line (including module-gap blank lines) with
  `arxml-diff-placeholder`; the CSS neutralizes Monaco's inserted/deleted line, char, gutter and
  sign paints. The owning side keeps its change fill. Selection tint is skipped on placeholders;
  merge arrows remain the host's delete/copy affordance.
- `diff-one-sided` fixture/audit reads the actual aligned models and computed styles. It fails on
  fake braces, green/red placeholder fill, missing owning-side fill, or an unavailable model.
  Negative controls: reverting the brace guard fails with fake braces; disabling the placeholder
  CSS fails five fill/gutter/sign checks; transparenting all fills fails the owning-fill check.
- Local sample pair: 12,422 aligned lines per side, 10 one-sided rows, 0 non-empty missing-side
  lines. `RemovedMod`/`SharedContainerDef "Inner"`, `AddedContainer`, `DiffExtraMod`, renamed
  modules and `EmptyDef`/`MissingDef` verified. No sample files/scripts entered the repo.
- Full suite: 977 passing; 33/33 preview states; `check-types`, `lint`, production bundle pass.
- Limitations: placeholder CSS is coupled to Monaco 0.57's line DOM and `:has()`; the audit
  fails if that DOM changes. The overview ruler still marks the change, and the preview audit is
  dark-only. Monaco's diagonal alignment padding is neutral and documented.

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
