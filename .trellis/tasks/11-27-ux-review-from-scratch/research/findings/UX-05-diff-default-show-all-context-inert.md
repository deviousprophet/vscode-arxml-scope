# UX-05 — The diff opens in "Show all" with an inert pressed Context toggle and no change summary

- **Severity:** Minor
- **Journey:** DIFF-01/DIFF-04 (default view, Context), DIFF-05 (finding changes)
- **Heuristic:** Nielsen #1 visibility of system status, #6 recognition rather than recall
- **Confidence:** High for the state, Medium for "wrong default" (the docs call the missing count
  intentional). **Confirmed in the host**: `diff-01-loaded-webview.png` shows Show all pressed,
  Context dimmed/disabled, and the `a11y` tab order skips `diff-context` entirely.

## Repro

1. Capture `diff-off` (the first state, before any gesture) or any `toolbar-*` state.
2. Inspect the view group and the Context button.

## Expected

The panel should state what changed and how to reach it. If Context only applies to one view
mode, it should be visibly unavailable (and not look switched on) in the other.

## Actual

- The panel opens in **Show all** (`diff-view-all` has `aria-pressed="true"` in
  `renderDiffToolbarHtml`, `changesOnly = false` in `diffMonaco.ts`). Every unchanged row is
  rendered; the documented 5-line context mode and its hidden-region controls are not the
  landing view.
- **Context is both pressed and disabled**: `syncToolbarState()` → `setViewMode(false)` sets
  `disabled` (`.diff-tool:disabled { opacity: 0.45 }`), while `setContext(contextActive = true)`
  keeps `aria-pressed="true"`. The result is a dimmed but blue "active" button — measured fill
  `rgb(20, 48, 67)` vs `rgb(9, 71, 113)` for the two true toggles — that does nothing when
  clicked. The only explanation is a hover tooltip.
- There is **no changed/added/removed count anywhere** (`docs/user/DIFF.md` states this is
  deliberate), so on a large file the user cannot tell whether the comparison has 1 change or
  500; `Prev diff` / `Next diff` are the only guides, and the overview-ruler marks are two narrow
  lanes at the far right.

Evidence: `research/evidence/preview/diff-off.png`, `toolbar-1400.png` (1400×900, DPR 1);
`src/webview/components/toolbar/toolbar.ts` (`renderDiffToolbarHtml`, `setViewMode`,
`setContext`); `src/webview/diffMonaco.ts` (`changesOnly`, `syncToolbarState`).

Host confirmation: `research/evidence/host/diff-01-loaded-webview.png` (1082×799, DPR 1) shows
Show all pressed and Context visibly dimmer than its neighbours; the `a11y` scenario recorded the
diff tab order as `diff-view-all, diff-view-diff, diff-mode-semantic, diff-mode-strict, diff-prev,
diff-next, diff-merge, diff-swap, diff-collapse-all, diff-expand-all` — `diff-context` is skipped
because it is disabled.

## UX impact

The first thing a reviewer sees is a wall of unchanged rows plus a control that looks on but is
inert. The "what changed / how much" question is unanswered at exactly the moment the panel opens,
which costs a `Next diff` keystroke just to learn the shape of the work.

## Actionable fix

1. Default to **Show diff** (changes + 5 context rows, hidden-region controls) and keep
   `Show all` one click away; it is the mode the docs describe as the review mode.
2. When Show all is active, render Context **unpressed and disabled** (clear
   `aria-pressed`/use an `aria-describedby` "applies to Show diff"), so "unavailable" and
   "switched on" do not collide.
3. Put a compact change summary in the existing `#diff-match-status` slot on open
   (`4 changes · 2 modules`) — it already owns the `role="status"` live region for search.

Not fixed in this task (review only).
