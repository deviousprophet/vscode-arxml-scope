# Polish UX chrome and errors

## Goal

Close the Minor findings from the fresh and deep review:

- **UX-03** — the sidebar show/hide toggle is painted as the primary action and looks permanently
  on.
- **UX-04** — every diff label is dropped at 1082 px although half the row is empty.
- **UX-05** — the diff opens in Show all with an inert pressed Context toggle and no change count.
- **UX-08** — activation failure leaks `(1 is the host protocol)` twice.
- **UX-09** — the diff find count reads `? of 3` instead of `1 of 3`.
- **UX-11** — the gate warning promises a text editor that never opens.
- **UX-12** — the diff reuses the gate copy when a side stops being ECUC.
- **UX-13** — the module-missing refusal names neither the module nor a way to it.
- **UX-14** — the skipped-file tooltip gives three alternative reasons instead of the real one.
- **UX-15** — `revealMode = replace` leaves the ECUC tab open with a duplicate label.

Source: the matching `research/findings/UX-*.md` files in
`.trellis/tasks/11-27-ux-review-from-scratch/`.

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
6. Gate copy is truthful: if the file has no ECUC values, either show the promised text editor or
   say no editor opened and offer **Open as Text**; the diff variant says the comparison stopped
   updating and offers **Reload comparison** / **Open as Text**.
7. A missing-module merge refusal names the module and offers **Reveal module**.
8. Index skip diagnostics name one actual reason and the threshold; no three-way “or” list.
9. `revealMode = replace` leaves one tab (or a clearly renamed ECUC tab) and the documented
   behavior matches.
10. Add preview/host regressions for each; no feature redesign beyond the finding.

## Acceptance criteria

- [ ] Sidebar toggle no longer reads as the primary action.
- [ ] Diff toolbar at 1082 px shows labels or a labelled overflow; no unlabeled Merge.
- [ ] Context is enabled when shown, or disabled without a pressed state; a change count is
      present or its absence is explained.
- [ ] Missing-engine activation copy contains no `(1 is the host protocol)` or `npm` jargon.
- [ ] Diff find shows `1 of 3` after the first Enter.
- [ ] Gate copy and diff stale-side copy are truthful and offer the promised action.
- [ ] Merge module refusal names the module and offers a reveal action.
- [ ] Index skip tooltip names one reason and the threshold.
- [ ] `replace` reveal leaves one tab or two distinguishable tabs.
- [ ] Preview toolbar widths and host `diff`/`missing-engine`/`first-gate`/`diff-side-not-ecuc`/
      `merge-collision`/`index-toggles`/`reveal-modes` scenarios pass.
- [ ] `npm run check-types`, `npm run lint`, `npm test` pass.

## Non-goals

- Changing diff save, first-file comparison, or editor refusal/recovery (children 1–2).
- Light-theme contrast (child UX-10).
- A new design system or toolbar rewrite.
