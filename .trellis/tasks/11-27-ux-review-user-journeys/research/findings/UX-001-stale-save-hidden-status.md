# UX-001 — A blocked save for a stale node is reported only in the Details status line

- Severity: Major
- Journey: EDIT-16
- Surface: ECUC editor / save
- Heuristic: flow, usability (feedback, error recovery)
- Confidence: high (preview + host)

## Expected

When `Ctrl+S` cannot apply a pending edit because the node is no longer in the file, the page
tells the user at the save action or at the row: a visible error strip, a row marker, and text
that names the node and says the edit was **not** written. The state must be impossible to
mistake for a normal pending save.

## Actual

`editor-stale-save.png` shows:

- the top strip still reads **• Unsaved changes** (the ordinary pending-edit state);
- the row is still selected and tinted, with no error decoration;
- the only failure text is an amber line in the bottom-right corner of the Details pane:
  **"The node is no longer in the file."**

The page gives no indication that the save attempt was rejected beyond that distant status
line. A user who pressed `Ctrl+S` and moves on can close the editor believing the edit is
saved.

## Repro

1. `node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --state editor-stale-save`
2. Read `research/evidence/preview/editor-stale-save.audit.json` (0 violations),
   then open `editor-stale-save.png`.
3. Observe the top strip, the selected row, and the bottom-right status line.

## Evidence

- `research/evidence/preview/editor-stale-save.png`
- `research/evidence/preview/editor-stale-save.audit.json`
- `research/evidence.md`, `research/evidence/preview-audit-summary.md`

## Notes

The docs place field refusals inline and other failures in the Details status line when the tab
is hidden (`docs/user/ECUC_EDITOR.md`). This state has the Details tab visible, so the failure
should not be routed to the least prominent channel. Real-host confirmation is scheduled in
Phase 3 (EDIT-16).

## Host confirmation (2026-11-27)

Confirmed in the real Extension Development Host (`research/host-runs.md`, EDIT-16):

- a parameter draft was typed, then the container was renamed underneath it;
- `Ctrl+S` did not write, the top strip still read `● Unsaved changes`, and the only refusal
  text was `The node is no longer in the file.` in `#details-status` (bottom-right);
- the row stayed selected with no error decoration.

Evidence: `research/evidence/host/edit-16-stale-workbench.png`,
`research/evidence/host/edit-16-stale-webview.png`. Confidence: **high**.
