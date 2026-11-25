# Design — one-sided marker and Collapse All

## Marker rule

`DiffRow.left`/`right` describe whether the row exists on each side. `subtreeHasDifference` now
returns false when the collapsed root is missing either cell. It then evaluates the root with the
existing name-only rule and descendants normally.

## Fold sync

`foldTogglePlan` previously compared the source and target collapsed sets and toggled any
difference on the target. If Collapse All folded a left-only row on the original, the sync from
the modified pane saw that row as target-only and unfolded it.

The planner now receives both `sourceLineByKey` and `targetLineByKey` and skips keys missing from
either side. A row that exists on only one pane is never folded or unfolded by sync.

For ordering, `scheduleFoldSync` captures a monotonic action version. Only the latest hidden-area
event runs a sync, so an older unfold event cannot undo a newer fold.

## Preview

- `diff-collapse-all` uses `removedPair()` and clicks the toolbar Collapse All action. The audit
  requires the left-only module header and the shared module header to remain visible while their
  children hide.
- `diff-collapsed` and `diff-collapsed-onesided` use the pinned folding contribution directly in
  the probe, with fold-only states skipping unrelated gutter/sash gestures.
- The one-sided gap state records only the folded visible fill count; expanded native fill remains
  covered by `diff-removed`/`diff-added`.

## Rollback

Revert the task commit; the marker and fold planner return to the previous behavior.
