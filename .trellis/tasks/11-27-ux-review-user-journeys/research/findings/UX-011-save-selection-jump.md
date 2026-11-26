# UX-011 — A successful save moves the selection and Details to an unrelated row

- Severity: Major
- Journey: EDIT-40 (continuity), EDIT-19 (save)
- Surface: ECUC editor / save
- Heuristic: usability (feedback, consistency), flow (continuity)
- Confidence: high (real host)

## Expected

After `Ctrl+S` writes an edit, the edited row stays selected, Details keeps showing that row,
and the scroll anchor, focus and folds stay where the user left them. A successful save must
not make the user hunt for the row they just changed.

## Actual

In the real host, a large ECUC document was scrolled to the bottom, `P99 = 99` was selected and
changed to `91`, and `Ctrl+S` was pressed.

| Check | Before save | After save |
|---|---|---|
| Details node | `P99` (`/P/Big/C/P99`) | `P85` (`/P/Big/C/P85`) |
| Scroll anchor | `P68 = 68` … `}` | `P68 = 68` … `}` |
| Focus | `native-edit-context` | `native-edit-context` |
| Edited row in view | yes | yes |

The write succeeded and the dirty strip cleared, but the selection jumped to `P85` while the
edited row stayed `P99`. The page rebuilds the model after the host echo and applies the host's
older `selectedId` over the row the user had just clicked. A second Details edit would target
`P85`, not the row the user just saved.

## Repro

1. Build the extension and debug engine.
2. Run the host with only the continuity scenario:
   ```powershell
   $env:HOST_ONLY='save-continuity'
   node .trellis/tasks/11-27-ux-review-user-journeys/research/host/run.mjs
   ```
3. The driver writes a 400-parameter document, opens it in the ECUC editor, scrolls to the last
   parameter, edits `P99`, and presses `Ctrl+S`.
4. Read `research/evidence/host/driver-report.json` → `save-continuity`; compare
   `beforeDetails` (`P99`) with `afterDetails` (`P85`).

## Evidence

- `research/evidence/host/save-continuity-before-webview.png` — `P99` selected, Details `P99`.
- `research/evidence/host/save-continuity-after-webview.png` — `P85` selected, Details `P85`,
  `P99 = 91` visible and written.
- `research/evidence/host/save-continuity-after-workbench.png`
- `research/evidence/host/driver-report.json` → `save-continuity` observations.

## Notes

- This is a **successful** save, distinct from UX-001 (a refused stale-node save). Both make the
  post-save state untrustworthy for different reasons.
- Scroll and selection are independent: the scroll anchor and focus survived while the selected
  row did not. Continuity checks must assert each one separately.
- Likely fix: keep the page's selected node across the save echo and ignore a host `selectedId`
  that predates the user's click, or make the host echo the current selection. Add the
  `save-continuity` scenario as a regression guard.
