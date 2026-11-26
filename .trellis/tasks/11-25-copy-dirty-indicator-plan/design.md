# Design — merge-copy responsiveness and unsaved-copy indication

> Local planning only. Start on the next branch after PR #42 merges.

## Current copy path

`diffPanel.ts` posts a `copy` intent from the webview. The host:

1. opens both text documents;
2. checks the snapshot;
3. asks the engine for a copy plan (`requestCopyPlan`);
4. applies the plan as a text edit (`applyPlan`);
5. the text-document change schedules a diff refresh and a full document post.

The latency is likely dominated by the full diff/document refresh and the text-edit round trip, not
the engine plan itself. The benchmark must split those phases before optimizing.

## Proposed next-branch changes

### Copy

- Measure plan request, apply, diff recompute, document serialization and webview paint.
- Prefer the engine's `diff.patch`/row patch after the copy; avoid a full `diff.compute` and full
  `postDocument` for one hunk.
- Preserve scroll, folds, selection and sash ratio across the patch.
- Add a page-local pending state on the target side while the host works; remove it on the host
  patch or error.

### Dirty protocol

- Send the affected target row keys/line mappings with the copy acknowledgement.
- Carry the target side's dirty state separately from the source side.
- The page keeps a `copiedDirty` row set per side until save acknowledgement.
- A save clears the set; a refusal/stale copy removes the pending state and shows the error.

### Editor view

- Use Monaco line/glyph decorations on the synthetic lines for copied rows, plus the existing
  dirty title marker.
- Style with VS Code theme tokens; do not copy Notepad++ colours literally.
- Distinguish “modified by copy, unsaved” from ordinary local typing and from diff added/removed
  paint.

### Diff view

- Decorate the affected side and rows with a dirty/copy indicator.
- Keep the native diff paint; the dirty indicator must layer above/beside it without changing the
  diff meaning.
- Clear only after the target document save ack.

### Undo / replace / switch

- Undo removes the pending copy decoration when the copied edit disappears.
- Save keeps it until acknowledgment.
- Document replacement or switching editor/diff rebuilds the state from host dirty + copied-row data.

## Benchmark shape

- Copy 1, 10 and 100 rows.
- Record engine plan, apply, diff refresh, post and paint times separately.
- Compare current vs patched on Windows and one CI Linux/macOS run.
- Acceptance should be a measurable reduction, not just “feels faster”.

## Test shape

- Host tests for targeted patch, dirty row set and save/refusal transitions.
- Editor preview state with copied dirty rows.
- Diff preview state with one side copied dirty.
- Existing merge/copy suites remain green.

## Task split for the new branch

1. Copy latency benchmark + targeted patch.
2. Host copied-dirty state and protocol.
3. Editor dirty-line decorations.
4. Diff dirty-side/row decorations.
5. Save/refusal/undo integration.
