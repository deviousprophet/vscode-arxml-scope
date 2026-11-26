# Fix copied-row review findings

## Goal

Close the copied-row defects found in the PR #44 review before the feature is treated as
finished: a malformed copied-row payload can crash the diff page, multiple changes in one
document event can misclassify a copied span, and a pending copy of an added row marks the
**source** side even though only the target may be marked. Add the missing save/refusal
coverage.

## Requirements

1. **Validate the diff page's `copyDirty` payload.** A value that is not
   `{ left: string[], right: string[] }` is dropped without throwing and leaves the previous
   markers untouched.
2. **Shift records with pre-event offsets.** One document event's `contentChanges` all use
   offsets from before the event. For each record:
   - sum the deltas of changes whose `end <= record.start`;
   - drop the record when any change overlaps the original `[start, end)` span;
   - leave the record unchanged when every change is after the original span;
   - ignore the event entirely when its version is not newer than the record's version.
3. **The pending marker is target-only.** A copy that adds a row has no target line before the
   host patch, so it shows no pending marker; the copied-dirty marker appears after the host's
   `copyDirty`. The source side is never marked.
4. **Cover save and refusal.** A save clears every marker in the document. A refusal clears
   the pending marker, adds no copied marker, and leaves earlier markers intact.
5. **Keep the docs honest.** Update the copied-row protocol contract and the user merge guide to
   match the fixed behaviour.

## Acceptance criteria

- [ ] Core tests cover two changes where the first shifts the span and the second would overlap
      the unshifted span, summed deltas before the span, and an after-span no-op.
- [ ] Protocol tests cover a missing `left`/`right` array and non-string row entries.
- [ ] The diff page drops a malformed `copyDirty` payload without throwing or clearing markers.
- [ ] A preview state proves a refused one-sided copy paints no source marker and no pending
      marker; a save-cleared state paints no marker at all.
- [ ] `npm run check-types`, `npm run lint`, `npm test`, `npm run engine:smoke` and
      `npm run rust:test` pass.
- [ ] The affected preview states and the full seeded set pass for the preview change.

## Constraints

- No public API or protocol field removal; `copyResult` keeps `side`, `key` and `requestId`.
- No UX redesign of merge/copy; the marker stays a margin bar plus tint where it already is.
- No change to the reusable preview package under `packages/webview-preview/`.
- The preview harness remains the repo-specific skill; do not port it in this task.

## Non-goals

- Adding the copy-to-paint benchmark phase (separate follow-up).
- Defining copy redo semantics (separate follow-up).
- Refactoring the host's refusal path beyond what the tests need.
- Removing `CopyDirtyStore.clear()`/`forget()` or other speculative cleanup.
