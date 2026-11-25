# Fix Merge gutter alignment before scroll

## Goal

The built-in hunk gutter's copy buttons must sit on their diff hunks as soon as Merge is enabled, without needing a scroll to correct them.

## Requirements

- Opening the diff and toggling Merge on must place every visible `Copy Block` gutter item on its hunk immediately.
- Scrolling must keep the items aligned; scrolling down and back must not introduce drift.
- Toggling Merge off and on again must preserve alignment.
- The fix must not change the built-in gutter, sash or copy semantics.
- The preview audit must catch this class of bug instead of only checking that gutter items exist.

## Acceptance criteria

- [ ] A preview probe compares each visible gutter item's vertical position with its hunk's start line before any scroll and reports the mismatch.
- [ ] On a freshly loaded diff with Merge toggled on, the mismatch is within one line height for every visible hunk.
- [ ] After scrolling down and back, the same probe still passes.
- [ ] Toggling Merge off/on in the live preview keeps the probe green.
- [ ] Full preview set, `check-types`, lint, tests, fallow and production bundle pass.

## Non-goals

- Restyling the native gutter or its hover toolbar.
- Changing which hunks offer copy actions.
- Replacing Monaco's gutter with a custom overlay.
