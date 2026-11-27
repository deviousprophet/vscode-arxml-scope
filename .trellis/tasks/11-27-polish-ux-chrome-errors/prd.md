# Polish UX chrome and errors

## Goal

Close the five Minor findings from the fresh review:

- **UX-03** — the sidebar show/hide toggle is painted as the primary action and looks permanently
  on.
- **UX-04** — every diff label is dropped at 1082 px although half the row is empty.
- **UX-05** — the diff opens in Show all with an inert pressed Context toggle and no change count.
- **UX-08** — activation failure leaks `(1 is the host protocol)` twice.
- **UX-09** — the diff find count reads `? of 3` instead of `1 of 3`.

Source: the matching `research/findings/UX-0*.md` files.

## Requirements

1. Sidebar toggle uses neutral/ghost styling; state remains clear (`aria-pressed`), but it is not
   the strongest element on the page.
2. Diff toolbar keeps labels until the measured content genuinely overflows; at 1082 px the
   existing labels fit in 588 px. Secondary controls may move to a labelled overflow menu.
3. Diff default/Context state is truthful: no inert control presented as pressed; show a change
   count or explain the absent count. Choose a default and document it.
4. Activation error copy is user-facing: no protocol constants, no duplicate toast; keep the
   persistent, actionable failure path.
5. Diff find shows the current match (`1 of N`) after Enter/next.
6. Add preview/host regressions for each; no feature redesign beyond the finding.

## Acceptance criteria

- [ ] Sidebar toggle no longer reads as the primary action.
- [ ] Diff toolbar at 1082 px shows labels or a labelled overflow; no unlabeled Merge.
- [ ] Context is enabled when shown, or disabled without a pressed state; a change count is
      present or its absence is explained.
- [ ] Missing-engine activation copy contains no `(1 is the host protocol)` or `npm` jargon.
- [ ] Diff find shows `1 of 3` after the first Enter.
- [ ] Preview toolbar widths and host `diff`/`missing-engine` scenarios pass.
- [ ] `npm run check-types`, `npm run lint`, `npm test` pass.

## Non-goals

- Changing diff save, first-file comparison, or editor refusal/recovery (children 1–2).
- A new design system or toolbar rewrite.
