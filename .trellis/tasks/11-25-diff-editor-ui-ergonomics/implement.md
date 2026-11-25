# Implementation plan — diff and editor UI ergonomics

## Phase 1 — Title strip and toolbars

- [x] Replace the title-strip grid/divider with the single flex bar and separator.
- [x] Drop the raw schema suffix from `setTitle`; keep it in the tooltip.
- [x] Move `#diff-swap` into the left group after Merge; remove `toolbar-center`.
- [x] Change the diff toolbar to the flex layout; keep the status right.
- [x] Move the editor `.grow` slot between Expand and Sidebar.
- [x] Update `diffView.test.ts`, `toolbar.test.ts` and the component specs.

## Phase 2 — One-sided copy/delete

- [x] Make both availability keys true when either side owns a semantic row.
- [x] Add the target-side fallback key in `gutterCopyRequest` while keeping the empty source side.
- [x] Update the preview audit for both rendered labels and the empty-side copy.
- [x] Update `MERGE.md`, `WEBVIEW_PREVIEW.md`, `DESIGN.md`, `monaco.md`, `diff-parity.md` and `preview-audit.md`.

## Phase 3 — Find scroll and tooltip

- [x] Guard empty queries in `findBridge`: no `matches`, no `request`, no next/previous match.
- [x] Add the empty-query unit test.
- [x] Verify `Ctrl+F` and `Ctrl+H` leave both `getScrollTop()` values at 0 on `diff-merge`.
- [x] Keep the compact-tooltip `pointer-events: none` fix and the source-contract test.
- [x] Re-run the browser hover loop; record `enter`/`leave`/`fade`/opacity.

## Phase 4 — Gates

- [x] `npm run check-types`
- [x] `npm run lint`
- [x] `npm run compile-tests`; `npm test --ignore-scripts` — 909 passing
- [x] full preview skill set — 37 states, exit 0
- [x] fallow GREEN
- [x] `node esbuild.js --production`
- [x] `git diff --check`
- [ ] commit, merge the parity/docs branches into #42, push, CI

## Evidence

### Find tooltip blink

Root cause: Monaco's compact hover is positioned over its anchor. The hover
container accepted pointer events, so it took the hover, hid itself, and the
close button re-triggered it. `elementFromPoint` at the button centre alternated
between the button and `.workbench-hover-container` / `.context-view`.

Before the fix the real-pointer loop measured `enter: 9`, `leave: 9`,
`classChanges: 9`, `fade: 9`; opacity cycled `1 → ~0.3 → 1 → 0`.
After `.monaco-hover.workbench-hover.compact`,
`.workbench-hover-container:has(...compact)` and `.context-view:has(...compact)`
get `pointer-events: none`, the loop measured `enter: 1`, `leave: 0`,
`fade: 1` and opacity stayed `1.00` for all 24 samples.

### Ctrl+F / Ctrl+H

The empty-query guard alone stopped the host request but the native widget still
moved both diff panes from `scrollTop 0` to `33`. `wireFindScrollGuard` captures
both editors' `scrollTop` in the capture phase and restores it on the next
animation frame. After the fix, `Ctrl+F` and `Ctrl+H` both leave
`original=0`, `modified=0` with the find widget visible.

### Preview

The full seeded set (37 states) passes with no audit violations. The
`diff-removed`/`diff-added` states now require both copy directions and do not
accept a one-sided hunk with only one available action. The title strip adds
`box-sizing: border-box` so its horizontal padding cannot create a 20px page
overflow.

## Rollback

Revert the task commits; no protocol or persisted-data migration.
