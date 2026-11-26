# UX-007 — The line-1 "More Actions…" menu covers the rows it acts on

- Severity: Minor
- Journey: MERGE-19
- Surface: Semantic diff / hunk toolbar overflow
- Heuristic: layout, flow
- Confidence: low — native Monaco overflow behaviour, no host comparison yet

## Expected

When a short hunk at line 1 collapses its copy actions into **More Actions…**, the menu opens
without hiding the element the user is about to copy, and the direction is still clear.

## Actual

`diff-one-sided.png` shows the overflow menu at the top of the right pane, overlapping the
`module P.AddedMod "AddedMod"` row and the `AddedItems` row below it. The menu contains
**Copy Block to Left** and **Copy Block to Right** with no indication which side owns the
element; the row being copied is partly obscured by the menu.

## Repro

1. `node .agents/skills/webview-preview/scripts/shotWebview.mjs --state diff-one-sided`
2. Read `diff-one-sided.audit.json` — `gutterProbe.clicked` is `More Actions...`,
   `overflowLabels` lists both directions, menu nodes are present.
3. Open `diff-one-sided.png` and locate the menu over the right pane's rows 1–2.

## Evidence

- `.agents/skills/webview-preview/artifacts/diff-one-sided.png`
- `.agents/skills/webview-preview/artifacts/diff-one-sided.audit.json`
- `research/evidence/preview-audit-highlights.md`

## Notes

The menu placement comes from Monaco's built-in hunk toolbar, so a fix may be constrained to
offset/anchor handling. Keep severity Minor and confidence low until MERGE-19 runs in the host.

## Disposition (Phase 4)

**Limitation, not a report finding.** The placement is Monaco's native hunk-toolbar overflow,
the confidence is low, and the host pass did not reproduce it as a functional obstruction. Not
scored; a future host run can re-open it if the menu blocks the target row at line 1.
