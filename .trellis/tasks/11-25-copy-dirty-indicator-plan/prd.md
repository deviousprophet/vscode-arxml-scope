# Plan merge-copy responsiveness and unsaved-copy indication

> Local planning only. Do not commit this task with the current PR. Start it on the next branch after PR #42 merges.

## Goal

Make merge copy feel immediate and make unsaved copied changes visible in both the single-document editor and the diff view before the user saves.

## Requirements

### Copy responsiveness

- Measure the current copy path end to end: engine copy/plan request, host document apply, diff rebuild, row patch, webview repaint.
- Remove unnecessary full-document reloads, rescans or diff recomputations from a single-hunk copy.
- Prefer the engine's row patch / incremental diff result and preserve scroll, folds, selection and sash position.
- Show an immediate pending state on the copied side while the host confirms, without pretending the save already happened.
- Define behavior for a refused or stale copy: roll back the pending decoration and show the existing error.

### Unsaved-copy indication

- A copy marks the target side dirty until the user saves.
- The source side must not be marked dirty by the copy.
- Single-document editor: mark copied rows with a Notepad++-style modified-line indicator in the margin/line background, without overriding diff colours or current-line highlight.
- Diff view: mark the changed side and affected rows as dirty, distinct from added/removed/changed diff paint.
- The marker clears only after a successful save; a failed save or refusal keeps it.
- Define undo/redo, document replacement and switching between editor and diff without losing the dirty state.

## Acceptance criteria for the next branch

- [ ] A latency benchmark records copy-to-paint time for 1, 10 and 100 rows before and after the change.
- [ ] A single-hunk copy does not trigger a full document reload or full diff recompute.
- [ ] Copied target rows are visibly pending/dirty in both the editor and diff view before save.
- [ ] The source side stays clean.
- [ ] Save clears the dirty markers only after acknowledgement; refusal/stale copy keeps a correct state.
- [ ] Scroll, folds, selection and sash ratio survive the copy.
- [ ] Tests and preview states cover editor dirty lines, diff dirty side/rows, save and refusal.

## Non-goals

- Implementing this in the current PR.
- Changing copy semantics or conflict refusal rules.
- Copying the Notepad++ visual style literally; use the same idea with VS Code theme tokens.
- Marking every unsaved edit identically; copied-row state may be a distinct kind of dirty state.

## Reference

Notepad++ modified-line margin is a useful reference for per-line unsaved indication, but the implementation must use Monaco decorations and VS Code theme tokens.
