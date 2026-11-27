# Design — UX review from scratch

## Tooling

| Layer | Owner | Path |
|---|---|---|
| Reviewer role, rubric, handoff | `ux-reviewer` agent | `.opencode/agents/ux-reviewer.md` |
| Seeded review + real host | `ux-review` skill | `.agents/skills/ux-review/` |
| Preview state table and limits | skill reference | `.agents/skills/ux-review/references/WEBVIEW_PREVIEW.md` |
| Stack decision and host evidence | skill reference | `.agents/skills/ux-review/references/WEBVIEW_PREVIEW_STACK.md` |

The task owns evidence and the report only. It must not add another preview/host script or a
`docs/` preview page.

## Evidence pipeline

1. **Inventory** — write `research/journeys.md` from the user docs, `package.json` contributes and
   `arxmlScope.*` settings. Every row gets a continuity result and a capture-fidelity note.
2. **Preview** — run the skill's `scripts/preview/shotWebview.mjs`; capture rendered states; read
   each audit JSON before the PNG; copy the PNGs/audits into `research/evidence/preview/`.
3. **Host** — run the skill's `scripts/host/run.mjs` with `HOST_OUT` at
   `research/evidence/host/`; use `UX_HOST_ONLY` for focused scenarios and
   `UX_HOST_MODE=missing-engine` for activation failure. Record window/webview size, DPR and zoom
   from `driver-report.json → captures`.
4. **Findings** — one file per issue with severity, journey, heuristic, expected vs actual, repro,
   evidence and confidence.
5. **Report** — `research/UX_REVIEW.md`, exact three-section template; link the journey matrix and
   evidence index.
6. **Handoff** — ask for consent to create/start a separate fix task; do not fix here.

## Continuity probes

Every host round-trip (save, copy, undo/redo, rename, refresh, settings/theme, document patch)
records before/after: scroll anchor and exact `scrollTop`, selected row/caret, focus, folds,
active pane/tab, find state, sash, markers and the edited row's visibility. Scroll and selection
are independent; a save can preserve one and move the other. At least one probe starts scrolled
away from the top with the edited row off-screen.

## Capture fidelity

Preview captures are standalone 1400×900 pages, not host parity. Host captures record workbench
inner size, frame `innerWidth`/`innerHeight`, DPR and zoom; a 1440×900 workbench with side
bar/Chat leaves roughly 780–1080 CSS px for the webview. Width-sensitive findings state the
measured webview width and test 100% plus one changed zoom (e.g. 80%).

## Evidence and report location

- Committed: `research/journeys.md`, `research/findings/`, `research/UX_REVIEW.md`,
  `research/evidence.md`, preview/host PNGs and audit JSON.
- No `docs/contributor` preview pages or docs index rows.
- The report stays in the task; the skill references are the durable tool documentation.

## Design review

After preview/host evidence, load
`.agents/skills/ux-review/references/DESIGN_REVIEW.md` and run the adapted Floor/Reflex/Finish
gates cold. The reference uses an internal floor/reflex/finish gate model, adapted for a VS Code
desktop IDE; marketing-page rules (hero, themes, 40px touch, 320–1920 breakpoints) are not
imported. Floor
failures are at least Major; map findings into the existing four dimensions, not a fifth score.

Before the cold review, run the cross-state stability probe in
`.agents/skills/ux-review/references/STATE_STABILITY.md` and `scripts/preview/state-diff.mjs`.
Compare a baseline with every variant at the same viewport; stable controls keep their rect, order
and visible identity within 1 px. A status, label, count or loading indicator getting a stable slot
is the normal fix; it must not move a toolbar action.

## Agent workflow

The main agent dispatches `ux-reviewer` with the active task path. The reviewer resolves the task,
runs Phase 1–2 (inventory + preview), then Phase 3 (host), then Phase 4–5 (findings + report).
The review task ends with the handoff prompt. The agent writes only under the task research
directory and does not modify `src/**`, specs or docs.

## Risks

- Preview capture can flake (`no rendered-geometry audit`); retry the named state, record the
  retry, and do not treat it as a page defect.
- CDP host attach can be flaky; retry once, then record `N/A` with the blocker.
- The old archived report is not evidence for this run; only new captures/findings count.
- Large evidence sets: commit PNGs/audits, keep traces local and note them.

## Rollback

Delete the new task branch; the skill/agent remain unchanged, so a future review can restart.
