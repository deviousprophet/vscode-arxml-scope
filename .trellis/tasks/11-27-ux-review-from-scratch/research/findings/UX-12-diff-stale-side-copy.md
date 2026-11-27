# UX-12 — The diff reuses the gate copy when a side stops being ECUC

- **Severity:** Minor
- **Gate:** Reflex — truthful copy
- **Journey:** DIFF-15 (a side stops being ECUC while the panel is open)
- **Heuristic:** Nielsen #1 visibility of system status, #3 user control and freedom
- **Confidence:** High — reproduced in the host

## Repro

1. Run the host with `UX_HOST_ONLY='diff-side-not-ecuc'`.
2. Open `left.arxml ↔ right.arxml`.
3. Replace `right.arxml` with a non-ECUC ARXML document and wait for the refresh.

## Expected

The notice explains that **this** comparison stopped updating, that the last good result is still
shown, and what to do next (reload the file / reopen as text). `docs/user/DIFF.md` says: "If a side
stops being ECUC-Values while the panel is open, the last good comparison stays visible and a
warning explains why it stopped updating."

## Actual

- The last good comparison stays visible (56 rows), which is correct.
- The notice is the **gate reason**:
  `"right.arxml" contains no ECUC values; showing the text editor instead.`
- It says a text editor is shown, but the diff panel is still the active surface; no text editor
  opens. It never says the comparison is now stale or how to resume.
- Evidence: `research/evidence/host/deep-diff-side-not-ecuc-workbench.png`,
  `research/evidence/host/deep-diff-side-not-ecuc-webview.png`,
  `research/evidence/host/driver-report-deep-all.json` (`diff-side-not-ecuc`).

## UX Impact

The user is told the wrong thing about the active surface and is not told the comparison has
stopped updating. They may keep reading or merging from a stale diff without realising it.

## Actionable Fix

1. Use a diff-specific notice:
   `right.arxml is no longer ECUC-Values. The comparison stopped updating; showing the last good result.`
2. Add one action: **Reload comparison** (rebuild from the current documents) or **Open as Text**.
3. Keep the gate message for the open command only.

Not fixed in this task (review only).
