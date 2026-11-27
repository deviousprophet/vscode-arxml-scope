# Design — fix copied-row review findings

## Boundaries

| Concern | Owner | Change |
|---|---|---|
| Copied-row records and offset shifting | `src/core/copy/copyDirty.ts` | Pure algorithm fix; no `vscode`, no DOM |
| Diff message boundary | `src/diffProtocol.ts` + `src/webview/diffMonaco.ts` | One runtime guard for `copyDirty.rows` |
| Optimistic marker | `src/webview/diffMonaco.ts` | Target-only placement |
| Save/refusal proof | `.agents/skills/ux-review/` | Two seeded states and audit checks |
| Contract and user wording | `.trellis/spec/frontend/editor-lifecycle.md`, `docs/user/MERGE.md` | Describe the fixed rules |

No host API, protocol field or public type is removed.

## 1. Runtime guard for `copyDirty`

`diffProtocol.ts` owns the message union. Add:

```ts
export function isCopyDirtyRows(value: unknown): value is CopyDirtyRows {
  if (typeof value !== 'object' || value === null) return false;
  const rows = value as { left?: unknown; right?: unknown };
  return (
    Array.isArray(rows.left) &&
    Array.isArray(rows.right) &&
    rows.left.every((key) => typeof key === 'string') &&
    rows.right.every((key) => typeof key === 'string')
  );
}
```

`dispatchCopyMessage` checks it before assigning `copiedRows`. An invalid payload is still
“handled” (returns `true`) but does not clear the pending copy or repaint, so the last good
state survives. The editor page already filters its `string[]`; leave that page unchanged.

## 2. Pre-event offset shifting

Every `CopyTextChange` in one event uses offsets from before the event. Replace the per-change
sequential loop with one computation against the **original** record:

```ts
function shiftedRecord(record: CopyRecord, changes: readonly CopyTextChange[]): CopyRecord | undefined {
  let delta = 0;
  for (const change of changes) {
    if (change.end <= record.start) {
      delta += change.text.length - (change.end - change.start);
    } else if (change.start < record.end) {
      return undefined; // overlaps the original span
    }
  }
  return delta === 0 ? record : { ...record, start: record.start + delta, end: record.end + delta };
}
```

Rules:

- insertion exactly at `start` (`start === end === record.start`) counts as before and shifts
  the span;
- insertion exactly at `end` counts as after and leaves it;
- any change with `change.end > start` and `change.start < end` drops the record, even when an
  earlier change in the same event already shifted the record’s working offsets;
- `version <= record.version` still short-circuits to the untouched record.

`applyChange` keeps its boolean contract: `true` only when the set of marked keys changed.

Tests must include the case the old code got wrong: record `[100,140)`, change 1 inserts at
`0`, change 2 inserts at `105` in the same event. The old loop shifted to `[110,150)` and then
treated `105` as before; the record must be dropped.

## 3. Target-only pending marker

`pendingMarker()` resolves the target side with `oppositeSide(pendingCopy.side)` and returns it
only when `copyLine(target, key)` is defined. It never falls back to the source. For a copy that
adds a row, the target line does not exist before the host patch, so no pending marker is
painted; the host’s `copyDirty` then paints the copied-dirty marker. The source side is never
decorated by either marker.

Refusal already clears the pending state in `dispatchCopyMessage` (`copyResult`), so no host
change is needed. The preview state proves it.

## 4. Preview proof

Add two seeded states:

| State | Seed | Audit |
|---|---|---|
| `diff-copy-refused` | merge on, one-sided hunk, click the gutter copy, answer `copyResult { ok: false }` | zero `.arxml-copy-pending` in both panes; zero `.arxml-copied-line` in both panes |
| `diff-copied-saved` | merge on, seed copied rows, then post empty `copyDirty` | zero `.arxml-copied-line` and `-bg` in both panes |

Implementation shape:

- `previewStateFields.ts`: `copyRefusal?: boolean`, `copiedCleared?: boolean`.
- `previewData.ts`: add the two states; seed `diff-copy-refused` from the one-sided fixture,
  seed `diff-copied-saved` with `copied: true, copiedCleared: true`.
- `previewPage.ts`: after `probeGutter()` records the posted copy, if `copyRefusal` post the
  matching `copyResult` with `ok: false` and wait a tick; after `applyCopied()`, if
  `copiedCleared` post `{ left: [], right: [] }`.
- `previewAudit.ts`: add `copyRefusal?: boolean` and `copiedCleared?: boolean` to `AuditState`;
  skip `copiedMarkerIssues` when `copiedCleared`; add the refusal check. Record the posted
  copy in the audit so a state that never clicked cannot pass silently.
- `.agents/skills/ux-review/references/WEBVIEW_PREVIEW.md` state table: add both rows.

The states use existing fixtures and selectors; no new layout surface.

## 5. Docs

- `editor-lifecycle.md` item 14: state that one event’s changes are pre-event and overlap is
  decided against the original span; state that the pending marker is target-only and an added
  row waits for the host patch.
- `MERGE.md`: say a refused copy adds no marker and leaves earlier markers untouched, instead
  of “keeps it” implying the refused copy had one.

## Risks and trade-offs

- **No optimistic feedback for added-row copies.** The pending bar disappears for that one
  gesture; the copied-dirty marker still appears after the host answers. This is the only way
  to keep the source side unmarked.
- **Preview reliance for page behaviour.** The diff page has no jsdom suite; the preview state
  is the rendered proof. Core and protocol fixes still have fast unit tests.
- **Older VS Code events.** VS Code reports pre-event offsets for one `contentChanges` array;
  the algorithm follows that contract. A multi-event batch is processed in event order.

## Validation

`npm run check-types`, `npm run lint`, `npm test`, the two new preview states, the full seeded
preview set (layout-affecting change), `npm run engine:smoke`, `npm run rust:test`.

## Rollback

Revert the branch. No migration or persisted data changes; `CopyDirtyStore` is in-memory only.
