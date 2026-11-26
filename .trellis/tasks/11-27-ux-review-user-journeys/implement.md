# Implementation plan — UX review: user journeys and edge cases

## Phase 1 — Reviewer and inventory

- [ ] Create `.opencode/agents/ux-reviewer.md` from the approved Principal UX Researcher
      prompt: role, input handling, 1–5 rubric across usability, hierarchy, accessibility and
      flow efficiency, severity mapping, exact report structure, journey workflow and write
      guardrails.
- [ ] Sanity-check the agent frontmatter and that it is discoverable; load the `webview-preview`
      skill in its instructions.
- [ ] Read `docs/user/*.md`, `package.json` contributes and all `arxmlScope.*` settings.
- [ ] Write `research/journeys.md` with ids, persona, preconditions, steps, expected, failure/
      edge path, evidence column and verdict column. Every command and setting gets a row.
- [ ] **Gate:** every command and every setting appears at least once; primary + cancel +
      invalid + missing-resource path per surface.

## Phase 2 — Preview evidence

- [ ] `node .agents/skills/webview-preview/scripts/shotWebview.mjs --list`; map rendered
      journeys to states.
- [ ] Capture the mapped states; read each `audit.json` before its PNG.
- [ ] Record geometry/paint findings and screenshots that look plausible but fail the audit.
- [ ] If a journey has no state, add the smallest state to the preview skill, document it in
      `docs/contributor/WEBVIEW_PREVIEW.md`, and recapture.
- [ ] **Gate:** every rendered journey has a state or a recorded gap.

## Phase 3 — Real host evidence

- [x] Build the extension and debug engine: `node esbuild.js`,
      `node scripts/build-engine.mjs --debug`.
- [x] Use the reusable `ux-review` skill runner at
      `.agents/skills/ux-review/scripts/host/` (`@vscode/test-electron` + temp workspace from
      `src/test/fixtures/diff/{left,right}.arxml` + CDP attach + `active-frame` targeting +
      command/setting bridge). Do not copy it into the task; keep only evidence here.
- [x] Run the primary journeys first: open editor, select first + compare, open diff, merge
      copy, save, engine status, rebuild index.
- [ ] Run the edge journeys: cancel a dialog, invalid value, refusal, stale node, missing
      engine, unsupported platform, huge file, no workspace, read-only file, closed comparison
      file, keyboard-only, high contrast/reduced motion.
      — Partial: stale node, missing engine, deleted first file, same file twice and
      keyboard-only ran; the rest are listed as `N/A` in `research/host-runs.md`.
- [x] Add a save-continuity scenario: a large document scrolled to its last parameter, edit,
      `Ctrl+S`, then compare scrollTop, selected row/caret, focus, folds and the edited row's
      visibility. Fail the scenario on a jump to the top, lost selection, lost focus or lost
      folds even when the file was written.
      — Ran; write, scroll and focus survived, but Details moved from `P99` to `P85`. New
      **UX-011**; evidence in `research/evidence/host/save-continuity-*`.
- [ ] Repeat the continuity probe for copy/save, undo/redo, rename, settings/theme change and a
      diff rebuild; record `preserved` or `lost` per journey in the matrix.
- [x] Capture before/after screenshots and a trace for every multi-step finding.
      — Screenshots and the Playwright-scenario report are in `research/evidence/host/`; no
      `.zip` trace was kept (CDP tracing of the whole workbench was too heavy for the task
      budget). The scenario report is the step record.
- [x] Add a `capture-fidelity` scenario: record the workbench window size, webview frame size,
      devicePixelRatio and `window.zoomLevel`; capture at 100% and 80% zoom and prove the webview
      CSS width changes. Put the sizes next to each evidence artifact.
      — Ran. 100%: workbench 1440×900, frame 786×777, DPR 1. 80%: workbench 1728×1080,
      frame 1074×949, DPR 0.833. `window.zoomLevel` stayed 0, so the frame width + DPR are the
      effective measurement.
- [x] For toolbar/overflow findings, capture at two effective widths and state the measured
      webview width and zoom; do not treat a 1400 px preview as host parity.
      — UX-002 qualified to 786–990 px at 100% zoom; a 1400 px preview keeps its labels.
- [x] **Gate:** every executed journey has evidence and a verdict; every skipped journey says
      why.

## Phase 4 — Findings and scoring

- [x] Write one finding file per issue under `research/findings/`.
- [x] Order by Critical → Major → Minor; each has repro, expected vs actual, heuristic, evidence
      and confidence.
- [x] Write the strengths section with the same specificity as the findings.
- [x] Score the four dimensions 1–5; compute the mean; apply the `broken` cap to Flow efficiency.
- [x] Write the prioritized fix list by user impact and dependency.

## Phase 5 — Report and cleanup

- [x] Write `.trellis/tasks/11-27-ux-review-user-journeys/research/UX_REVIEW.md` using the
      approved structure exactly: Executive Summary, Scorecard, Prioritized Findings. Link the
      journey matrix and evidence index.
- [x] Keep the report and evidence inside the task research directory; do not add a
      `docs/README.md` row or a `docs/` page.
- [x] Verify links and the agent/report formatting.
- [x] Confirm no `src/**` change; review `git status`.
- [x] Kill VS Code, Chrome/Playwright and the bridge; remove temp workspaces and profiles.
- [ ] **Gate:** all acceptance criteria in `prd.md` are checked with evidence.

## Phase 6 — Findings handoff

- [ ] If the review found any issue, stop and ask the user for consent to create and start a
      separate Trellis fix task (or tasks).
- [ ] Include the finding ids, severity, evidence paths and a proposed task split.
- [ ] Do not fix findings inside this review task.

## Validation

```powershell
# Preview states and audit JSON
node .agents/skills/webview-preview/scripts/shotWebview.mjs --list
node .agents/skills/webview-preview/scripts/shotWebview.mjs --state <name>

# Extension and engine for the real host
node esbuild.js
node scripts/build-engine.mjs --debug
node .agents/skills/ux-review/scripts/host/run.mjs

# Repository gates (no source change, but keep the tree healthy)
npm run check-types
npm run lint
```

## Review gates

1. After the journey inventory: coverage review before any capture.
2. After the host harness: one primary journey proven end-to-end before running the matrix.
3. Before the report: severity and evidence review; no finding without a repro.

## Rollback

Delete the task research, the report and the agent file; no production behavior or data changes.
