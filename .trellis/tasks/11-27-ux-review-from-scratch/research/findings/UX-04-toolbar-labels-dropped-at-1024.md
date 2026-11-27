# UX-04 — Every diff label is dropped at 1024 px although half the toolbar row is empty

- **Severity:** Minor
- **Journey:** DIFF-03 (toolbar at 1400/1200/1024/900/800/640), A11Y-07 (icon labels),
  MERGE-01 (discovering Merge)
- **Heuristic:** Nielsen #6 recognition rather than recall; progressive disclosure/density
- **Confidence:** High — **confirmed in the host**: at 1440×900, 100 % zoom, Explorer open, the
  webview frame is **1082 px** and the diff toolbar renders **icon-only** (`gate-02-diff-workbench.png`,
  `diff-01-loaded-webview.png`); the audit geometry and the 1200 px preview show the labelled strip
  needs only 588 px.

## Repro

1. `node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --state toolbar-1024`.
2. Read `toolbar-1024.audit.json` → `toolbar.groups.left.clientWidth = 475`,
   `viewport.width = 1008`, `overlaps/outside/clipped = []`.

## Expected

Labels are removed only when the strip actually runs out of room, and the highest-consequence
control (Merge — the only write path in the diff) keeps a recognisable treatment longest.

## Actual

At 1008 CSS px the diff toolbar is **icon-only for all 11 controls** (`.diff-tool .lbl` is hidden
at `max-width: 1150px`, `toolbar.css`), yet the left group is only **475 px of the 1008 px**
viewport — **533 px, more than half the row, is empty**. The 11 icons are unlabeled; `Merge`
(the write action), `Swap sides`, `Collapse` and `Expand` are four adjacent 40 px grey glyphs with
no text and no accent, and Merge/Swap are visually similar arrow motifs. Discovery depends on
hovering each icon to read its native tooltip.

The 1200 px state keeps the Context/Semantic/Strict/Merge labels and is 588 px wide, so the
equipment exists; it is the 1150 px breakpoint that throws all of it away.

Evidence: `research/evidence/preview/toolbar-1024.png`,
`research/evidence/preview/toolbar-1024.audit.json`,
`research/evidence/preview/toolbar-1200.png`; `src/webview/components/toolbar/toolbar.css`
(`@media (max-width: 1150px)`).

Host confirmation: `research/evidence/host/gate-02-diff-workbench.png` (1440×900 workbench,
**1082×799** webview, DPR 1, zoom 0) renders the same 11 unlabeled icons. `capture-fidelity`
measured **1082 px at 100 %** and **1369 px at 80 %** for the same window, so the label breakpoint
is hit on the default zoom and cleared one zoom step out.

## UX impact

A user at a common laptop width (a 1440 px window with a side bar/Chat leaves ~1000 px for the
webview) sees a row of eleven anonymous icons. The destructive/write action is indistinguishable
from navigation and from a panel toggle; the first interaction is a hover hunt.

## Actionable fix

1. Move the icon-only breakpoint down to the measured need: the 1200 px treatment (four primary
   labels kept) occupies only 588 px of the 1008 px row, so it still fits with ~420 px to spare;
   drop labels only when the group would actually overflow.
2. If a breakpoint is needed, keep the **Merge** label (or an accent outline + `Merge` tooltip
   chip) until the true icon-only step, because it is the only control that writes.
3. Do not drop labels while `toolbar-left.scrollWidth + toolbar-right.scrollWidth` leaves >20 %
   of the row unused — gate the breakpoint on measured overflow, not a fixed width.

Not fixed in this task (review only).
