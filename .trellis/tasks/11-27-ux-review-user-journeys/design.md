# Design — UX review: user journeys and edge cases

## Artifacts and boundaries

| Output | Location | Owner |
|---|---|---|
| Journey matrix | `.trellis/tasks/11-27-ux-review-user-journeys/research/journeys.md` | Review task |
| Finding records | `.trellis/tasks/11-27-ux-review-user-journeys/research/findings/*.md` | Review task |
| Evidence index and commands | `.trellis/tasks/11-27-ux-review-user-journeys/research/evidence.md` | Review task |
| Audit report | `.trellis/tasks/11-27-ux-review-user-journeys/research/UX_REVIEW.md` | Review task |
| Reusable reviewer | `.opencode/agents/ux-reviewer.md` | Review task |

No production `src/**` change. The preview skill is test-only and may gain states if a journey
has no seeded surface. The agent writes only to the task research directory and the report; it
never edits source, specs or user docs.

## Journey inventory

Write the matrix before capturing anything. One row:

```text
| id | surface | persona | preconditions | steps | expected | failure/edge | continuity | evidence | verdict |
```

Ids are stable and grouped by surface: `ENTRY-*`, `EDIT-*`, `DIFF-*`, `MERGE-*`, `INDEX-*`,
`ENGINE-*`, `SET-*`, `A11Y-*`, `FIRST-*`.

Coverage rules:

- every contributed command and every `arxmlScope.*` setting appears at least once;
- each surface gets a happy path, a cancel/back-out path, an invalid-input path and a
  missing-resource path;
- edge cases from the PRD are explicit rows, not an appendix;
- a journey that cannot run is `N/A` with the reason and the blocking limitation.

## Continuity probes

Every action that can rebuild the webview model is a continuity probe, not just a data check:
save, copy, undo/redo, rename, refresh, settings/theme change, document patch, compare/reload.

Snapshot before and after:

| State | Measure |
|---|---|
| Scroll | exact `scrollTop` plus the visible anchor row/line |
| Selection/caret | selected row id, line/column, focus target |
| Folds/sticky | collapsed container ids and sticky header text |
| Panes | active tab, sidebar/panel, diff split and sash |
| Find | query, current match and visible highlights |
| Markers | dirty/copied markers, page strip and status line |
| Viewport | visible rows/lines and the edited row's position |

`preserved` means the exact scroll (within 2 px), same selected row/caret, focus in the same
control, same folds/search/panes and the edited row still in view. A jump to the top, a cleared
selection, a lost caret, collapsed folds or a moved split is a finding even when the write
succeeded. A full model reset is acceptable only when the view state is restored; otherwise it
is at least Major.

At least one probe per mutating surface must start with the document scrolled away from the top
and the edited row off-screen. A top-of-file fixture cannot expose this class.

## Capture fidelity

The capture is evidence only for the size, zoom and layout it recorded.

- Record the workbench window inner size, the webview frame `innerWidth`/`innerHeight`,
  `devicePixelRatio`, `window.zoomLevel`, and whether the auxiliary bar/side bar was open with
  every screenshot.
- The preview skill renders a standalone 1400 px page. A real 1440×900 workbench with a side bar
  or Chat leaves roughly 780–1080 px of CSS width for the webview. Never present a preview width
  as the host width.
- Capture at the default zoom and at one changed zoom (80% and 120% are useful); zoom changes the
  effective CSS width and can create or hide a toolbar/overflow defect.
- For width-sensitive findings, state the measured webview width and zoom, and test at least two
  effective widths. Qualify whether a wider editor area avoids the issue.
- Keep both the workbench screenshot (chrome, tabs, dialogs) and the frame-body screenshot
  (content), and put the measured sizes in the evidence index.

## Evidence pipeline

### 1. Preview states (rendered surfaces)

- `node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --list`.
- Map each rendered journey to an existing state. Capture with `--state <name>`.
- Read `<state>.audit.json` before the PNG. Record geometry/paint violations as findings.
- If a journey has no state, add the smallest state to
  `.agents/skills/ux-review/preview/` and document it in
  `docs/contributor/WEBVIEW_PREVIEW.md`; do not invent a second renderer.
- Copy the audit JSON and the referenced PNGs into `research/evidence/preview/` and commit them
  with the task, so the review can continue on another machine. Do not leave the only copy in
  the skill's ignored `artifacts/` directory.

### 2. Real host (commands, keyboard, dialogs, errors)

Reuse the proven split from
[`WEBVIEW_PREVIEW_STACK.md`](../../../docs/contributor/WEBVIEW_PREVIEW_STACK.md):

- `@vscode/test-electron` launches the installed VS Code with the extension development path,
  a temporary workspace and `--remote-debugging-port`.
- A suite running inside the host opens documents and webviews through real commands.
- Playwright attaches over CDP to the workbench and targets the nested `active-frame` webview.
- A small skill-local bridge (HTTP on localhost) lets the Playwright driver ask the in-host suite
  to execute a command, read `vscode.env`, change a setting or report state. This avoids
  palette-typing flakiness for setup while the actual UX steps still use clicks, focus and
  keyboard where the user would.
- The reusable runner lives in the `ux-review` skill at
  `.agents/skills/ux-review/scripts/host/`; set `HOST_OUT` to this task's evidence directory.
  Task research keeps evidence, not a second copy of the scripts.
- Every run gets a fresh temp workspace copied from `src/test/fixtures/diff/{left,right}.arxml`
  plus any edge fixture. The user's working tree is never opened as the test workspace.

Evidence per journey: before/after screenshots, a Playwright trace for multi-step flows, the
command/setting used, and a short note of expected vs actual. A trace is required for any
interaction finding that is not obvious from one screenshot.

### 3. Recording

Each finding is one file:

```markdown
# <id> — <title>
- Severity: Critical | Major | Minor
- Journey: <id>
- Surface: <command / editor / diff / merge / index / engine / settings / a11y>
- Heuristic: usability | hierarchy | accessibility | flow
- Expected:
- Actual:
- Repro:
- Evidence:
- Confidence: high | medium | low
```

## Scoring

Use the four dimensions from the reviewer prompt, 1–5:

| Dimension | What it measures in this product |
|---|---|
| Usability & clarity | Command discoverability, labels, feedback, error prevention and recovery |
| Visual hierarchy | Toolbar/panel/row scannability, density, focus, CTA prominence |
| Accessibility & ergonomics | Contrast, focus visibility/order, keyboard-only paths, target sizes, reduced motion, zoom/font |
| Flow efficiency | Steps to the primary goal, cancellation, retry, edge/empty/error states |

The report's overall score is the mean of the four, rounded to one decimal. A journey verdict of
`broken` caps Flow efficiency at 2; a `Critical` finding is called out in the executive summary
regardless of the mean.

Severity:

- **Critical** — blocks a core journey, risks data loss, or has no workaround.
- **Major** — major friction or a wrong result with a hard workaround.
- **Minor** — visible friction, cosmetic or discoverability issue with an easy workaround.

Findings are ordered by severity, then user impact. Strengths are specific and tied to evidence.

## Real-host constraints

The host is a development install, not a marketplace VSIX. Record that limitation. Linux CI
would need `xvfb`; this review runs locally on Windows with the installed VS Code. Real
keyboard/IME, OS clipboard and screen-reader output are only partially observable; mark those
checks `N/A` with the reason unless a manual observation exists.

## Agent design

`.opencode/agents/ux-reviewer.md` is a subagent with read/bash/write permissions and a strict
write scope. It carries the role, input handling, four-dimension rubric, severity mapping,
exact report structure, journey workflow, evidence rules and cleanup guardrails from this
design. The main agent dispatches it with the active task path; the reviewer persists everything
to the task research directory and returns paths, not full prose.

## Risks

- **Flaky CDP attach** — retry once, then record `N/A`; never fabricate a result.
- **Preview is dark-theme oriented** — record light/high-contrast gaps as limitations rather
  than defects unless the source shows a real bug.
- **Journey explosion** — the matrix is exhaustive, execution is prioritized: P0/P1 journeys
  first, then the long tail. Coverage status is explicit for every row.

## Rollback

The task adds only research, a report and an agent definition. Revert the branch or delete those
files; no migration, no persisted state and no production behavior change.

## Findings handoff

The review stops at evidence and recommendations. When it produces any finding, the reviewer
asks the user for consent to create and start a separate Trellis task (or tasks) to fix it, then
returns the finding ids, evidence paths and proposed task split. No production fix, no source
edit and no release change happens inside this review task.

Committed evidence includes the journey notes, finding files, evidence index, audit JSON,
screenshots and host captures needed to continue on another machine. Traces may stay local and
be referenced with a note; the report links the committed paths.
