# UX-09 — The diff find count reads "? of 3" instead of "1 of 3"

- **Severity:** Minor
- **Journey:** DIFF-09 (find in the diff), DIFF-05 (next/prev navigation)
- **Heuristic:** Nielsen #1 visibility of system status; recognition over recall
- **Confidence:** High — visible in the host capture and recorded by the driver

## Repro

1. `$env:UX_HOST_ONLY='diff'; node .agents/skills/ux-review/scripts/host/run.mjs`
2. Focus the left diff pane, press `Ctrl+F`, type `ContKeep`, press `Enter`.

## Expected

The native count reads `1 of 3` (or `2 of 3` after navigation) and highlights the current match —
`docs/user/DIFF.md` documents "Native `1 of N` / `No results`".

## Actual

The find widget reads **`? of 3`**: the total is correct, the current index is a literal question
mark. The driver records `findCount: "? of 3"`; the screenshot shows the same string.

The scenario's check passes because it accepts any non-empty count
(`count.length > 0`), so the defect is visible but not gated.

Evidence: `research/evidence/host/diff-03-find-workbench.png` (crop of the widget at 1082 px),
`research/evidence/host/driver-report-r2.json` (`diff` observations: `findCount: "? of 3"`).

## UX impact

The number of matches is known but the position is not, so the user cannot tell whether `Enter`
advanced, whether the current highlight is first or last, or how many remain. On a long diff this
is the only progress signal the widget gives.

## Actionable fix

1. Populate the current-match index from the search result/navigation state and render
   `1 of 3`; keep `? of 3` only while the index is genuinely unknown, and then show
   `3 results`.
2. Strengthen the host check to require `\d+ of \d+` so this cannot regress silently.

Not fixed in this task (review only).
