# Design — Merge gutter alignment

## Feedback loop

Use the preview skill's interactive server. Open `?state=diff-off`, let the diff settle, then
post `{ type: 'mergeMode', enabled: true }` exactly as the preview state loader does.

Probe:

1. Find every `.monaco-diff-editor .gutterItem`.
2. For each item, read its bounding rect and the `top` style Monaco assigned.
3. Resolve the matching line change from `__ARXML_DIFF_EDITOR__.getLineChanges()` and compute
   the expected top with `modifiedEditor.getTopForLineNumber(lineNumber)`, offset by the
   editor DOM's top.
4. Report `actual - expected` per visible item.
5. Repeat after a scroll away and back.

The loop is red when the freshly toggled items differ by more than one line height and green
after the fix. It is deterministic because the seeded document and viewport are fixed.

## Hypotheses

1. **Hidden-layout state.** Gutter items are created while Merge is off and CSS hides them with
   `display: none`; toggling Merge reveals them at coordinates computed for a different layout.
2. **Missing relayout after the attribute flip.** `syncToolbarState` writes `data-merge` but never
   calls Monaco's `layout()` or a render pass, so the gutter uses stale line heights until a
   scroll forces `view.render`.
3. **Stale line changes.** The gutter items are positioned from the previous `lineChanges` array
   when Merge turns on, and only the scroll's diff view update remaps them.
4. **Host-height change.** Showing the merge status or toolbar changes `#diff-monaco`'s height
   after the gutter was positioned, and the next scroll corrects the offset.

Instrumentation will log the gutter rect, `getTopForLineNumber`, `getScrollTop`, the item's
inline `top`, the diff editor height and `lineChanges` before and after the attribute flip and
after `requestAnimationFrame`. The one variable changed per probe is the merge attribute.

## Likely fix shape

Once the diagnosis names the stale input, make the smallest change at that seam:

- if hidden layout: render the gutter after the attribute is applied and the host has a height;
- if missing relayout: call the correct Monaco `layout()`/render entry point after
  `data-merge` changes;
- if stale line changes: wait for the diff update and then reveal the gutter;
- if host height: settle the toolbar height before positioning.

No protocol, persisted-data or copy-semantics change.

## Regression

Extend the existing gutter audit with an alignment snapshot: visible item `top`, expected line
top, and delta. It must run before the existing focus/scroll actions and again after a scroll.
Pin the tolerance to one line height so a hidden-item or stale-layout regression fails.

## Rollback

Revert the task commit; no migration.
