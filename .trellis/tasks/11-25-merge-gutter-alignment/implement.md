# Implementation plan — Merge gutter alignment

## Phase 1 — Reproduce

- [x] Start the preview server and open `?state=diff-off`.
- [x] Post `mergeMode enabled=true`; capture gutter item rects vs. line tops before any scroll.
- [x] Scroll down and back; capture the same deltas.
- [x] Toggle Merge off/on and capture again.

## Phase 2 — Diagnose

- [x] Record the item inline `top`, Monaco `getTopForLineNumber`, `getScrollTop`, host height and
      `lineChanges` at each step.
- [x] Test the ranked hypotheses in `design.md` one variable at a time.
- [x] Pin the root cause in the task notes before editing.

## Phase 3 — Fix and regression

- [x] Apply the narrowest fix at the stale-layout seam.
- [x] Add the alignment probe to `previewAudit.ts` and run it before the focus/scroll actions.
- [x] Verify the probe is red on the unfixed code and green after the fix.
- [x] Re-run the interactive toggle and scroll loop.

## Phase 4 — Gates

- [x] `npm run check-types`
- [x] `npm run lint`
- [x] `npm run compile-tests`; `npm test --ignore-scripts`
- [x] full `webview-preview` seeded set
- [x] fallow GREEN
- [x] `node esbuild.js --production`
- [x] `git diff --check`
- [x] commit and push the PR branch

## Diagnosis

The gutter items are created while Merge is off and the old CSS hid them with
`display: none`. Monaco's `DiffToolBar.layout` measures
`this._elements.buttons.clientHeight` and centers the 36px toolbar inside the
hunk using that height. A `display: none` ancestor makes `clientHeight` 0, so
the first layout used `itemRange.length / 2` and left the buttons at
`top: 9.5px` instead of `-8.5px`. Changing `data-merge` only flips CSS; it does
not call Monaco's gutter `layout`, so the arrows sat 17.5px too low until the
next scroll re-ran `EditorGutter.render`.

The failed hypothesis was host-height change: the item and host heights were
stable before and after the toggle. The item's inline button top was the only
stale input.

## Fix

`#diff-monaco:not([data-merge="true"]) .gutterItem` now uses
`visibility: hidden; pointer-events: none` instead of `display: none`. Hidden
items keep layout, so Monaco measures the real 36px toolbar and centers it
before Merge is revealed. They remain invisible, non-interactive and outside
the accessibility tree.

## Evidence

- Red probe before the fix: `the gutter copy buttons are 17.5px off the hunk centre`.
- After the fix: `diff-merge` reports `maxCenterOffset: 0.5`, `checked: 4`.
- Live toolbar toggle: center delta stayed `-0.5px` before the toggle, after
  enabling Merge, after scrolling down and back, after disabling Merge, and
  after enabling it again.
- While Merge was off, items reported `visibility: hidden` and
  `pointer-events: none`.
- `diff-removed` skips the zero-line deletion hunk and checks its changed hunk:
  `checked: 1`, `maxCenterOffset: 0.5`.
- Full seeded preview set: 37 states, exit 0.

## Rollback

Revert the task commit; no protocol or persisted-data migration.
