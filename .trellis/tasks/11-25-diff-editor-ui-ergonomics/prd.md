# Fix diff and editor UI ergonomics

## Goal

Fix six user-visible issues in the diff and ECUC editor: the stale-looking file-name strip, the missing empty-side delete direction in Merge, the Ctrl+F/H scroll jump, the find-tooltip blink, the centred Swap control, and the editor toolbar alignment.

## Requirements

- **Title strip.** The fixed file-name strip must not imply a 50/50 pane split after the sash is resized. Replace the grid/centre divider with one flex bar: left label, separator, right label. Do not show the raw schema number in the label; keep it in the tooltip.
- **One-sided merge.** A one-sided hunk must offer both copy directions. Copying from the owning side adds the block; copying from the empty side deletes it from the owning side. The hunk availability must be true when either side owns a semantic row, and the webview copy request must fall back to the target-side key so the host can delete.
- **Ctrl+F / Ctrl+H scroll.** Opening the native find widget with an empty query must not request a search or reveal a match. The diff viewport must stay at its current scroll position.
- **Find-tooltip blink.** Hovering the native find close button must show one stable tooltip; it must not oscillate between hover and hidden.
- **Swap alignment.** The diff `Swap sides` control must sit in the left action group, following Merge, not in a centred column. The right group keeps the match status.
- **Editor toolbar.** In the ECUC editor, Collapse and Expand stay on the left; the Sidebar/Details toggle stays on the right.

## Acceptance criteria

- [ ] The title strip is a single flex bar with no 50% divider and no raw schema suffix.
- [ ] Both copy actions render on `diff-removed` and `diff-added`; the empty-side action posts the owning row key and the host deletes.
- [ ] `Ctrl+F` and `Ctrl+H` on `diff-merge` leave `getScrollTop()` unchanged.
- [ ] Hovering the find close button shows one tooltip: `mouseenter` ≤ 1, `mouseleave` = 0, opacity stable at 1, and the tooltip container does not intercept the anchor.
- [ ] `#diff-swap` is inside `.toolbar-left` after `#diff-merge`; no `.toolbar-center` exists.
- [ ] The editor toolbar order is Collapse, Expand, flexible slot, Sidebar toggle.
- [ ] Full check-types, lint, tests, preview set, fallow and production bundle pass.

## Non-goals

- Reworking the native find widget or its search engine.
- Changing the host copy planner's whole-element semantics.
- Moving the title strip into VS Code's editor tab.
- Persisting sash ratios or toolbar layout.
