# UX-06 — `Ctrl+S` inside the diff does not save the merged document

- **Severity:** Major
- **Journey:** MERGE-11 (save the diff-changed file), CONT-04 (diff save continuity),
  MERGE-02 (copy round-trip)
- **Heuristic:** Nielsen #1 visibility of system status, #4 consistency and standards,
  #5 error prevention; trust in the save action
- **Confidence:** High — reproduced once with a deterministic fallback proof in the same run

## Repro

1. Build and run the host with the merge scenario:
   `$env:UX_HOST_ONLY='merge'; node .agents/skills/ux-review/scripts/host/run.mjs`
2. Open `left.arxml ↔ right.arxml`, press **Merge**, copy a hunk to the right.
   The pane label reads `right.arxml •` and the separate `right.arxml` tab is dirty.
3. Click in the modified (right) pane and press `Ctrl+S`.
4. Read the dirty state and the file bytes.

## Expected

The docs (`docs/user/MERGE.md`) say: "Save the file you changed with the normal **Save** …
`Ctrl+Z` in that pane undoes one copy; the pane label shows `•` while its document is dirty."
A save from the pane that shows the dirty marker should write the file and clear the marker.

## Actual

- `Ctrl+S` from the diff pane is a silent no-op:
  - `state.tabs` still contains `right.arxml` with `dirty: true`;
  - `right.arxml` bytes are unchanged (`7724 → 7724`);
  - no notification, no error, no dirty-marker change.
- Clicking the separate `right.arxml` **text tab** and pressing `Ctrl+S` then works:
  `dirtyAfterTabSave: []`, bytes change.
- The diff tab itself (`left.arxml ↔ right.arxml`) never shows the dirty dot; only the hidden
  text tab does. The pane's `•` and the tab's dot disagree about which surface owns the change.
- The hunk copy is undoable *in the pane* (documented) but not savable there, so the two
  keyboard actions that operate on the same dirty document behave inconsistently.

Evidence: `research/evidence/host/driver-report-r2.json` (`merge` observations:
`dirtyAfterSave: ["right.arxml"]`, `rightChanged: false`, `tabSaveWorked: true`),
`research/evidence/host/merge-02-copied-workbench.png`
(`right.arxml •` tab, `right.arxml •` pane label),
`research/evidence/host/merge-03-save-paths-workbench.png` (the text tab used to save).

## UX impact

The user follows the documented flow, sees `•` next to the pane, presses `Ctrl+S`, and gets no
feedback. They either assume the merge is persisted (and later lose it when the window closes
without saving the hidden tab) or conclude the copy failed. Recovering the change requires
discovering that a second, identically named tab owns the save.

## Actionable fix

1. Handle `save`/`Ctrl+S` in the diff webview and save every dirty document the panel owns
   (the receiving side), then clear the pane marker and show `Saved right.arxml`.
2. Or mark the diff tab dirty and let VS Code's standard save path prompt; today the tab is clean
   while the document is dirty.
3. Put a `Save right.arxml` action in the diff toolbar/notice while a copy is unsaved, so the
   save is discoverable without leaving the panel.

Not fixed in this task (review only).
