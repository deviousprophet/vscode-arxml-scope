# Implementation plan — UX review from scratch

## Phase 1 — Inventory

- [ ] Resolve the task and create `research/{journeys,findings,evidence}/`.
- [ ] Read `docs/user/*.md`, `package.json` commands/settings/custom editors and the skill
      references.
- [ ] Write `research/journeys.md` with every command and `arxmlScope.*` setting, happy/cancel/
      invalid/missing/continuity paths, evidence and verdict columns, and a P0/P1 execution order.
- [ ] **Gate:** every command and setting appears; every surface has a failure/edge path.

## Phase 2 — Preview evidence

- [ ] `node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --list` → 43 states.
- [ ] Map rendered journeys to states; capture the mapped states; read each audit JSON first.
- [ ] Copy PNGs/audits into `research/evidence/preview/`; record the capture conditions.
- [ ] Record rendered journeys with no state in `journeys.md → Preview gaps`.
- [ ] **Gate:** every rendered journey has a state or a recorded gap; audits read; 0 unexpected
      violations.

## Phase 3 — Host evidence

- [ ] Build `dist` and the debug engine (the host skill prerequisites).
- [ ] Run `.agents/skills/ux-review/scripts/host/run.mjs` with
      `HOST_OUT=.trellis/tasks/11-27-ux-review-from-scratch/research/evidence/host`.
- [ ] Prove the gate journey first (open editor → select first → compare → diff).
- [ ] Run the primary journeys and the high-risk edges: save continuity, diff save, stale save,
      merge copy/refusal, stale first file, same file twice, missing engine, index rebuild,
      keyboard/focus, capture fidelity at 100%/80% zoom.
- [ ] Record every executed journey in `research/host-runs.md` with verdict/evidence; mark unrun
      journeys `N/A` with a reason.
- [ ] **Gate:** every executed journey has evidence; every skip is explicit.

## Phase 4 — Findings and score

- [ ] Run the design-review gates from
      `.agents/skills/ux-review/references/DESIGN_REVIEW.md` against the evidence; record
      Floor/Reflex/Finish findings and map them into the four dimensions.
- [ ] One finding file per issue under `research/findings/`.
- [ ] Order Critical → Major → Minor; include repro, expected vs actual, heuristic, evidence,
      confidence.
- [ ] Score Usability & Clarity, Visual Hierarchy, Accessibility & Ergonomics, Flow Efficiency
      1–5; apply the `broken` cap; compute the mean to one decimal.
- [ ] Write strengths and a prioritized fix list.

## Phase 5 — Report and cleanup

- [ ] Write `research/UX_REVIEW.md` with exactly Executive Summary, Scorecard, Prioritized
      Findings.
- [ ] Update `research/evidence.md` with artifact paths, measured sizes/zoom and repro commands.
- [ ] Verify all links; confirm no `docs/` preview page and no `src/**` change.
- [ ] Kill VS Code/Chrome/bridge; remove temp workspaces; confirm no stray processes.
- [ ] **Gate:** every acceptance criterion in `prd.md` is checked.

## Phase 6 — Handoff

- [ ] If findings exist, ask the user for consent to create and start a separate Trellis fix
      task (or tasks).
- [ ] Include finding ids, severity, evidence paths and a proposed split.
- [ ] Do not fix findings in this review task.

## Validation

```powershell
node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --list
node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --state <state>
$env:HOST_OUT='.trellis/tasks/11-27-ux-review-from-scratch/research/evidence/host'
node .agents/skills/ux-review/scripts/host/run.mjs
Remove-Item Env:HOST_OUT
```

## Rollback

Delete the task branch; the skill/agent remain reusable.
