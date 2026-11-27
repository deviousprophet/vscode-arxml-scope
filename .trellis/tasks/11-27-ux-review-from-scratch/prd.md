# UX review from scratch with the ux-review skill

## Goal

Run a fresh full-extension UX review using the consolidated `ux-review` agent and skill. Do not
treat the archived review's findings as current evidence; build a new journey matrix, new
preview/host evidence, a new scorecard and a new severity-ranked report.

## Scope

- All nine contributed commands, the custom editor, title/context menus and every
  `arxmlScope.*` setting.
- ECUC editor, semantic diff, merge, index/navigation, engine, validation/Problems, themes and
  accessibility, first-run and packaging.
- Happy paths, cancel/back, invalid input, refusal/stale, missing resources and recovery for each
  surface.
- Continuity after every host round-trip (save, copy, undo/redo, rename, refresh, settings/theme,
  document patch): scroll, selection/caret, focus, folds, active pane/tab, find, sash and markers.
- Capture fidelity: workbench size, webview frame size, DPR and zoom, with width-sensitive
  findings measured at two effective widths.

## Method

- Load the `ux-review` skill: **Preview mode** for seeded rendered states, **Host mode** for the
  real VS Code Extension Development Host.
- Use the `ux-reviewer` agent for the review; it owns the rubric, journey matrix and report.
- Preview captures use `.agents/skills/ux-review/scripts/preview/shotWebview.mjs`; read each
  `<state>.audit.json` before the PNG.
- Host runs use `.agents/skills/ux-review/scripts/host/run.mjs` with `HOST_OUT` pointing at this
  task's `research/evidence/host/`.
- Use a fresh temp workspace; never open the user's working tree as the test workspace.
- Commit the preview PNGs/audits and host screenshots/JSON under this task's `research/evidence/`
  so the review travels to another machine.
- Score against clarity, feedback, error prevention/recovery, consistency, efficiency,
  accessibility, trust/safety and state continuity.

## Deliverables

1. `research/journeys.md` — every command and setting, happy/cancel/invalid/missing/continuity
   paths, stable ids, evidence, verdicts and execution order.
2. `research/findings/` — severity-ranked findings with repro, expected vs actual, heuristic,
   evidence and confidence.
3. `research/UX_REVIEW.md` — exactly Executive Summary, Scorecard, Prioritized Findings.
4. `research/evidence.md` — preview/host artifact index, measured sizes/zoom, reproduction
   commands.
5. `research/evidence/preview/` and `research/evidence/host/` — committed captures and audits.
6. **Findings handoff** — if any finding exists, stop and ask the user for consent to create and
   start a separate Trellis fix task.

## Acceptance criteria

- [ ] Every contributed command and every user-facing setting appears in the matrix.
- [ ] Each surface has a primary path plus cancel/invalid/missing/edge coverage.
- [ ] Preview `--list` returns 43 states; captured states have audit JSON read first; rendered
      journeys without a state are recorded as gaps.
- [ ] At least one save-continuity probe starts scrolled away from the top; scroll/selection/
      focus/folds are checked separately.
- [ ] Every capture records workbench/webview size, DPR and zoom; width-sensitive findings test
      two effective widths.
- [ ] Every P0/P1 finding has a repro and committed evidence.
- [ ] The report has exactly the three approved sections and a 1–5 scorecard.
- [ ] The review ends with the fix-task handoff; no production fix and no `src/**` change.
- [ ] No preview documentation is added back under `docs/`; the skill owns it.

## Non-goals

- Fixing findings.
- Changing the extension or the consolidated skill/agent unless a review-blocking defect is found.
- Reusing the archived review's report as the new report.
