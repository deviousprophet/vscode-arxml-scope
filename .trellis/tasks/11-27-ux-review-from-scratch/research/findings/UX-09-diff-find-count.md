# UX-09 — The find count reads "? of N" instead of "1 of N" (diff and editor)

- **Severity:** Minor
- **Gate:** Finish — counts must be real
- **Journey:** DIFF-09 (find in the diff), EDIT-18 (find in the editor), DIFF-05
- **Heuristic:** Nielsen #1 visibility of system status; recognition over recall
- **Confidence:** High — host-confirmed on both surfaces in the deep pass

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

Host confirmation, deep pass: the same defect appears in the **editor** find widget. With the
cursor in `ContKeep`, `Ctrl+F` and typing `Changed` produces **`? of 1`**
(`research/evidence/host/deep-find-webview.png`,
`research/evidence/host/driver-report-deep-all.json`, `find-replace.widgetText`). Both surfaces
use the shared native-find bridge, so the fix belongs in the shared current-index plumbing.
The deep-pass check now requires a numeric `\d+ of \d+` and fails on `? of 1`.

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
