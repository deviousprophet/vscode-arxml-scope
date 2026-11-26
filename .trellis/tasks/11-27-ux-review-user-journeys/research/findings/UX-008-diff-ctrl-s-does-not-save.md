# UX-008 — Ctrl+S in the diff does not save the copied document

- Severity: Major
- Journey: MERGE-15
- Surface: Semantic diff / two-way copy merge
- Heuristic: usability (feedback, consistency), flow
- Confidence: high (real host)

## Expected

After a merge copy, the pane shows an unsaved marker and the receiving file has a dirty tab.
Pressing `Ctrl+S` while the diff panel has focus saves the receiving document — the same
keyboard save the ECUC editor implements — or the panel states where to save it. The docs say
"Save the file you changed with the normal **Save**" (`docs/user/MERGE.md`).

## Actual

Real Extension Development Host, `merge` scenario:

- Copy Block to Right succeeded: pane label `right.arxml •`, a separate `right.arxml ●` tab
  appeared, and `right.arxml` is dirty.
- `Ctrl+S` with focus in the modified pane: **nothing happens**. The document stays dirty and
  the file on disk is unchanged (`7724 → 7724` bytes).
- Clicking the `right.arxml` tab and pressing `Ctrl+S`: saves; the dirty marker clears
  (`dirtyAfterTabSave: []`, `tabSaveWorked: true`).
- `Save All`: also saves (`saveAllWorked: true`).

So the copy is recoverable, but the most natural completion — save while looking at the result —
silently does nothing. A user who closes the diff after `Ctrl+S` loses the copy.

## Repro

1. `node .trellis/tasks/11-27-ux-review-user-journeys/research/host/run.mjs` with
   `UX_HOST_ONLY=merge`.
2. Enable **Merge**, hover a changed hunk, click **Copy Block to Right**.
3. Press `Ctrl+S` in the modified pane; inspect `/state` and `right.arxml`.
4. Click the `right.arxml` tab; press `Ctrl+S` again.

## Evidence

- `research/evidence/host/merge-02-copied-workbench.png` (pane bullet + dirty tab)
- `research/evidence/host/merge-03-save-paths-workbench.png`
- `research/evidence/host/driver-report.json` → `scenarios[id=merge].observations`
  (`dirtyAfterSave`, `rightChanged`, `dirtyAfterTabSave`, `tabSaveWorked`, `saveAllWorked`)

## Notes

This is an asymmetry with the ECUC editor, which installs a page-level `Ctrl+S` handler
(`editorMonaco.ts`) while the diff page has none. Fixing it may be a small keybinding handler
that posts the existing host save message; the workaround (switch to the file tab) is visible,
which keeps the current severity at Major rather than Critical.
