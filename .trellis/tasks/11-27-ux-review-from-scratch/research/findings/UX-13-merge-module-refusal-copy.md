# UX-13 — The module-missing refusal tells the user to copy the module but not which one

- **Severity:** Minor
- **Gate:** Reflex — recovery / duplicate step
- **Journey:** MERGE-06 (module-collision refusal)
- **Heuristic:** Nielsen #9 help users recognise, diagnose and recover; #6 recognition over recall
- **Confidence:** High — reproduced in the host; the copy is a no-op for the user

## Repro

1. Run the host with `UX_HOST_ONLY='merge-collision'`.
2. Compare two files whose modules differ (`ColX` on the left, `ColY` on the right).
3. Turn **Merge** on and copy a child hunk from the left module to the right.

## Expected

A refusal that names the missing module, says where it is, and offers a way to get there — or
selects the module hunk so the documented "copy the module first" step is one click.

## Actual

- The diff notice reads: **`the module is missing on the target side; copy it first`**.
- It does not name the module, does not say which side, and offers no action.
- The user just attempted a copy; "copy it first" is circular unless they find the module header
  themselves, which on a long diff means scrolling and recognising it.
- The refused copy correctly writes nothing.

Evidence: `research/evidence/host/deep-merge-collision-workbench.png`,
`research/evidence/host/driver-report-deep-all.json` (`merge-collision`: `notice.text`),
`src/host/diffPanel.ts` (`refuseActiveCopy('the module is missing on the target side; copy it first')`).

## UX Impact

The refusal is safe but not actionable. On a generated comparison the module header can be far
from the hunk; the user has to search for it and may simply give up on the merge.

## Actionable Fix

1. Name the module and the target:
   `ColX (/P/ColX) has no module on the right. Copy its module row first.`
2. Add a **Reveal module** action that scrolls to and selects the module hunk, or copy the module
   automatically when the user confirms.
3. Keep the write blocked until the module exists.

Not fixed in this task (review only).
