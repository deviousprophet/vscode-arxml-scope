# UX-15 — Reveal in source in `replace` mode leaves the ECUC tab open

- **Severity:** Minor
- **Gate:** Reflex — duplicate state / navigation
- **Journey:** ENTRY/EDIT-25 (`arxmlScope.ecuc.editor.revealMode = replace`)
- **Heuristic:** Nielsen #4 consistency and standards; #7 flexibility and efficiency
- **Confidence:** High — reproduced in the host; tab list and screenshot agree

## Repro

1. Run the host with `UX_HOST_ONLY='reveal-modes'`.
2. Set `arxmlScope.ecuc.editor.revealMode` to `replace`.
3. Open only the ECUC editor for `left.arxml` and click **Reveal in source** in Details.

## Expected

`docs/user/ECUC_EDITOR.md`: "`replace` swaps the ECUC editor's tab for the text editor." One tab,
the text editor, in the same group.

## Actual

- The text editor opens in the same group, but the custom editor tab **remains**.
- `/state` reports two tabs: `left.arxml:vscode-arxml-scope.ecucEditor` and `left.arxml`.
- Both tabs carry the same label, so the tab strip shows two identical `left.arxml` tabs.
- `beside` and `focus` behave as documented (the ECUC editor stays active in `beside`; focus moves
  in `focus`); only `replace` keeps the extra tab.

Evidence: `research/evidence/host/deep-reveal-replace-workbench.png`,
`research/evidence/host/driver-report-deep-all.json` (`reveal-modes.modes.replace`),
`src/host/navigation.ts`.

## UX Impact

The mode that exists to avoid the split still leaves a duplicate tab with the same name. The user
must close the custom editor manually and cannot tell the two tabs apart at a glance.

## Actionable Fix

1. Close the custom editor tab after the text editor is shown in `replace` mode, or
2. Rename the custom tab (`left.arxml (ECUC editor)`) so the two are distinguishable and document
   that `replace` keeps the editor available.

Not fixed in this task (review only).
