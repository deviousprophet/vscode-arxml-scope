# UX-11 — The gate warning promises a text editor that never opens

- **Severity:** Minor
- **Gate:** Reflex — truthful copy / Finish
- **Journey:** FIRST-03 (empty/malformed/non-ECUC file), ENTRY-04
- **Heuristic:** Nielsen #1 visibility of system status, #2 match between system and the real world
- **Confidence:** High — reproduced in the host for all three gate files

## Repro

1. Run the host with `UX_HOST_ONLY='first-gate'`.
2. With no editor open, run **ARXML Scope: Open with ECUC Editor** on `empty.arxml`,
   `malformed.arxml` or `not-ecuc.arxml`.

## Expected

Either the file opens in the text editor, as the message says, or the message only reports the
refusal and offers an explicit action (`Open as Text`).

## Actual

- The warning is
  `"empty.arxml" contains no ECUC values; showing the text editor instead.`
- `/state.tabs` is **empty** after the command: no ECUC tab, no text tab.
  `openEcucEditor` only calls `openTextDocument` to run the gate and then returns; it never
  `showTextDocument`s the file.
- The same happens for `malformed.arxml` and `not-ecuc.arxml`.

Evidence: `research/evidence/host/deep-first-gate-workbench.png`,
`research/evidence/host/driver-report-deep-all.json` (`first-gate` observations: `tabs: []` and the
three notifications), `src/commands.ts` `openEcucEditor` and `src/host/ecucEditorProvider.ts`
`gateReason`.

## UX Impact

The user invokes a command, is told the file is being shown in the text editor, and then sees
nothing. They must re-open the file themselves and may think the command failed. It also makes the
warning feel like a dead end on a first run.

## Actionable Fix

1. Call `vscode.window.showTextDocument(document)` after the gate refusal so the message is true,
   or
2. Change the copy to `"empty.arxml" has no ECUC values.` and add an **Open as Text** action to the
   notification.
3. Keep the ECUC editor from opening in both cases.

Not fixed in this task (review only).
