# Evidence index — UX review

All preview evidence was produced on 2026-11-27 from the repository root. Preview PNGs and audit
JSON live in the skill's ignored artifact directory; only the derived notes are stored in this
task.

## Commands that produced the evidence

```powershell
# 1. List the seeded states
node .agents/skills/webview-preview/scripts/shotWebview.mjs --list

# 2. Capture each mapped state (loop with up to 4 attempts per state)
node .agents/skills/webview-preview/scripts/shotWebview.mjs --state <state>

# 3. Derived notes (this folder)
#    preview-audit-summary.md     — every audit object, trimmed of syntax dumps
#    preview-audit-highlights.md  — fold/nav/sash/sticky/one-sided/gutter probes
```

- `--list` reported **43** states.
- **43/43 captured**, each with `<state>.png` and `<state>.audit.json`.
- Every audit was read before its PNG. **0 violations** across all 43 audits; every
  `ready` flag is true.
- The first whole-set run aborted twice with `no rendered-geometry audit in <state>`
  (`diff-collapsed-onesided`, then `diff-collapsed`). Re-running the same state alone
  succeeded every time; the capture is timing-sensitive, not the state. This is a harness
  flake worth fixing in the preview skill (retry-on-missing-audit), not a product finding.

## Artifact inventory

| State | Viewport | Ready | Audit violations |
|---|---|---|---|
| diff-added | 1384×805 | yes | 0 |
| diff-collapse-all | 1384×805 | yes | 0 |
| diff-collapsed | 1384×805 | yes | 0 |
| diff-collapsed-onesided | 1384×805 | yes | 0 |
| diff-copied | 1384×805 | yes | 0 |
| diff-find | 1384×805 | yes | 0 |
| diff-merge | 1384×805 | yes | 0 |
| diff-nav | 1384×805 | yes | 0 |
| diff-off | 1384×805 | yes | 0 |
| diff-one-sided | 1384×805 | yes | 0 |
| diff-rail | 1384×805 | yes | 0 |
| diff-removed | 1384×805 | yes | 0 |
| diff-sash | 1384×805 | yes | 0 |
| diff-sticky | 1384×805 | yes | 0 |
| diff-swap | 1384×805 | yes | 0 |
| diff-wide | 1384×805 | yes | 0 |
| diff-wide-panned | 1384×805 | yes | 0 |
| editor | 1384×805 | yes | 0 |
| editor-copied | 1384×805 | yes | 0 |
| editor-delete | 1384×805 | yes | 0 |
| editor-details | 1384×805 | yes | 0 |
| editor-details-redo | 1384×805 | yes | 0 |
| editor-details-rename | 1384×805 | yes | 0 |
| editor-details-save | 1384×805 | yes | 0 |
| editor-details-undo | 1384×805 | yes | 0 |
| editor-dirty | 1384×805 | yes | 0 |
| editor-find | 1384×805 | yes | 0 |
| editor-invalid | 1384×805 | yes | 0 |
| editor-labels | 1384×805 | yes | 0 |
| editor-multi-save | 1384×805 | yes | 0 |
| editor-paste | 1384×805 | yes | 0 |
| editor-rename-late-ack | 1384×805 | yes | 0 |
| editor-rename-refusal | 1384×805 | yes | 0 |
| editor-stale-save | 1384×805 | yes | 0 |
| editor-sticky | 1384×805 | yes | 0 |
| editor-syntax | 1384×805 | yes | 0 |
| editor-syscond | 1384×805 | yes | 0 |
| toolbar-1024 | 1008×805 | yes | 0 |
| toolbar-1200 | 1184×805 | yes | 0 |
| toolbar-1400 | 1384×805 | yes | 0 |
| toolbar-640 | 624×805 | yes | 0 |
| toolbar-800 | 784×805 | yes | 0 |
| toolbar-900 | 884×805 | yes | 0 |

PNG: `<repo>/.agents/skills/webview-preview/artifacts/<state>.png`
Audit: `<repo>/.agents/skills/webview-preview/artifacts/<state>.audit.json`

## Journey → state mapping

| Journey | State(s) | What the state proves |
|---|---|---|
| ENTRY-01, EDIT-01, EDIT-02 | `editor` | Shell, toolbar, row rendering, Details populated for a module |
| EDIT-03 | `editor-dirty` | Local draft visible, `• Unsaved changes` strip |
| EDIT-04, EDIT-20 | `editor-invalid` | Inline value error, Details error, blocked save strip |
| EDIT-06 | `editor-details` | Details value editing |
| EDIT-07, EDIT-17 | `editor-details-undo` | Local undo restores the field |
| EDIT-18 | `editor-details-redo` | Redo re-applies the draft |
| EDIT-19, EDIT-21 | `editor-details-save`, `editor-multi-save` | Save acknowledgement, multi-field save |
| EDIT-08 | `editor-details-rename` | Container short-name edit |
| EDIT-10 | `editor-rename-refusal` | Host refusal state |
| EDIT-22 | `editor-paste` | Newline paste handling |
| EDIT-16 | `editor-stale-save` | Stale node at save time |
| EDIT-26 | `editor-find` | Monaco find widget, 1 of 2 |
| EDIT-38 | `editor-copied` | Copied-row margin markers |
| EDIT-14 | `editor-delete` | Delete/word-delete edit scenario |
| EDIT-31, A11Y-02 | `editor` | Sidebar visible, rotated Details/Conditions tabs |
| EDIT-34 | `editor-sticky` | Sticky scope header |
| EDIT-30 | `editor-labels` | Label rendering / sort order display |
| — | `editor-syntax`, `editor-syscond` | Syntax colours and condition chips |
| — | `editor-rename-late-ack` | Rename acknowledgement arriving after re-scan |
| DIFF-01, DIFF-03, DIFF-11, DIFF-15 | `diff-merge` | Toolbar, Semantic active, panes, changed-word paint |
| DIFF-02 | `diff-swap` | Swap mirrors titles and panes |
| DIFF-04 | `diff-collapse-all` | Collapse/expand all |
| DIFF-05 | `diff-collapsed`, `diff-collapsed-onesided` | Single-container fold, markers and diagonal fills |
| DIFF-06 | `diff-find` | Find widget in the diff |
| DIFF-07 | `diff-nav` | Prev/Next wrap sequence, unchanged after swap |
| DIFF-08 | `diff-sash` | Drag, ratio persistence, double-click reset |
| DIFF-09 | `diff-sticky` | Sticky header visible during scroll |
| DIFF-10, MERGE-17 | `diff-off` | Read-only diff, no copy actions |
| DIFF-13, MERGE-04, MERGE-05 | `diff-one-sided`, `diff-added`, `diff-removed` | One-sided rows, diagonal fills, empty-side actions |
| DIFF-24, A11Y-06 | `toolbar-1400` … `toolbar-640` | Toolbar responsiveness |
| MERGE-01, MERGE-02 | `diff-merge`, `diff-copied` | Merge toggle and copy gutter |
| MERGE-19 | `diff-one-sided` | Line-1 overflow menu |
| DIFF-20 | `diff-rail` | 1,100-row document, long jumps |
| DIFF-24 | `diff-wide`, `diff-wide-panned` | Horizontal overflow inside the pane |

## Audit highlights (values read from the JSON, before the PNG)

- `diff-nav`: changes `[7,10,14,25]`; forward `[10,14,25,7,10]`; backward
  `[7,25,14,10,7]`; after swap `[7,10,14,25,7]` — wrap and side-independence hold.
- `diff-sash`: initial `[642,677]` → dragged `[782,537]` → unchanged after document
  rebuild and swap → reset `[642,677]`.
- `diff-sticky`: `visible: true`, height 38, text `13module P.Preview "Preview" Items "Items"`.
- `diff-one-sided`: 9 vs 17 lines, 2 diagonal fills, 0 placeholder elements, owning fill on
  the side that has the row.
- `diff-added`: 2 line changes, 2 diagonal fills, no placeholders.
- `diff-off`: `mergeActive: false`, gutter item not visible.
- `diff-one-sided` gutter: 4 items; the line-1 item exposes **More Actions…**, whose menu
  contains **Copy Block to Left** / **Copy Block to Right** and overlays the pane rows.
- `toolbar-1400`: all 11 controls labelled in a 588 px left group.
  `toolbar-1024`, `toolbar-800`, `toolbar-640`: still 11 controls, 0 clipped/outside/
  overlaps, but the captured pages show icon-only buttons; at 640 the left group is 312 px
  (≈28 px per control). `toolbar-1200` shows a mixed state (Context/Semantic/Strict/Merge/
  Swap sides labelled; Show all/Show diff/Prev/Next/Collapse/Expand icon-only).

## Preview limits recorded for the report

- The preview is dark-theme only; light and high-contrast host themes are not covered by a
  capture shell (skill limit).
- It is not the Extension Development Host: no tabs, no title bar, no notifications, no
  Problems panel, no native dialogs, no real save/permission path.
- It cannot prove keyboard/IME, screen-reader or clipboard behaviour.
- Missing rendered surfaces are listed in `journeys.md → Preview gaps`.

## Findings derived from preview evidence

- `findings/UX-001-stale-save-hidden-status.md`
- `findings/UX-002-diff-toolbar-label-loss.md`
- `findings/UX-003-copied-rows-missing-unsaved-strip.md`
- `findings/UX-004-details-derived-formats-stale.md`
- `findings/UX-005-rename-refusal-generic-strip.md`
- `findings/UX-006-vertical-sidebar-tabs.md`
- `findings/UX-007-merge-overflow-covers-rows.md`

## Host evidence (Phase 3)

The real-host runner is documented in `research/host-runs.md`; scripts live in
`research/host/`. Artifacts are under `research/evidence/host/`.

### Exact reproduction commands

```powershell
# Prerequisites (repo root)
node esbuild.js
node scripts/build-engine.mjs --debug

# Full normal matrix (12 scenarios)
node .trellis/tasks/11-27-ux-review-user-journeys/research/host/run.mjs

# One or more scenarios only
$env:UX_HOST_ONLY='merge'
node .trellis/tasks/11-27-ux-review-user-journeys/research/host/run.mjs
Remove-Item Env:UX_HOST_ONLY

# Missing-engine run (hides the binary, restores it in finally)
$env:UX_HOST_MODE='missing-engine'
node .trellis/tasks/11-27-ux-review-user-journeys/research/host/run.mjs
Remove-Item Env:UX_HOST_MODE
```

Each run creates a fresh `%TEMP%\arxml-ux-host-ws-*` workspace and
`%TEMP%\arxml-ux-host-profile-*`, and removes both on exit. No trace `.zip` is kept: the
per-scenario JSON plus workbench/webview PNGs are the step record.

### Host artifact index

| Artifact (under `research/evidence/host/`) | Scenario | Journeys / findings |
|---|---|---|
| `gate-01-editor-{workbench,webview}.png` | gate | ENTRY-01, EDIT-02; UX-006 (rotated tabs), UX-002 (narrow editor) |
| `gate-02-diff-{workbench,webview}.png` | gate | ENTRY-14, ENTRY-17 |
| `edit-01-dirty-{workbench,webview}.png` | edit | EDIT-01, EDIT-03; UX-004 (Value 7 vs Decimal 1) |
| `edit-02-saved-{workbench,webview}.png` | edit | EDIT-19 (`Ctrl+S` writes) |
| `save-continuity-before-{workbench,webview}.png`, `save-continuity-after-{workbench,webview}.png` | save-continuity | EDIT-40; **UX-011** (Details `P99` → `P85` while scroll/focus survive) |
| `edit-16-stale-{workbench,webview}.png` | stale-node | EDIT-16; **UX-001** |
| `entry-20-compare-two-{workbench,webview}.png` | compare-two | ENTRY-20 |
| `diff-01-loaded-*.png`, `diff-02-strict-*.png`, `diff-03-find-*.png`, `diff-04-next-long-*.png` | diff | DIFF-01, DIFF-03, DIFF-06, DIFF-07; UX-002 (icon-only at ~990 px) |
| `merge-01-on-*.png`, `merge-02-copied-*.png`, `merge-03-save-paths-*.png` | merge | MERGE-01, MERGE-02, MERGE-14, MERGE-15; **UX-008** |
| `merge-10-stale-{workbench,webview}.png` | stale-copy | MERGE-10 not reproduced (no modal) |
| `engine-01-status-workbench.png` | engine-index | ENGINE-01; INDEX-01 status bar |
| `index-04-rebuilt-workbench.png` | engine-index | INDEX-04 |
| `a11y-01-palette-*.png` | a11y | A11Y-01 (palette-only open) |
| `a11y-02-editor-focus-*.png` | a11y | A11Y-02 (toolbar order; sidebar tabs absent from Tab order) |
| `a11y-03-diff-focus-*.png` | a11y | A11Y-03 (11 controls in visual order) |
| `entry-16-stale-first-workbench.png` | stale-first | ENTRY-16; **UX-010** |
| `entry-24-same-file-workbench.png` | same-file | ENTRY-24 (generic “exactly two” refusal) |
| `probe-diff-{workbench,webview}.png` | probe-diff | DOM diagnostic: toolbar buttons 40×48 px, hunk action items, scroll containers |
| `missing-engine/first-02-missing-engine-workbench.png` | missing-engine | FIRST-02, ENGINE-04; **UX-009** |
| `missing-engine/driver-report.json` | missing-engine | notifications, registered commands, status bar |
| `driver-report.json` | normal | all 13 scenarios: checks, observations, screenshots |
| `host-activation.json`, `host-run.json` | both | activation timing/error and launch summary |

### Host finding map

| Finding | Host evidence | Status |
|---|---|---|
| UX-001 | `edit-16-stale-workbench.png`; `driver-report.json` → `stale-node` | confirmed |
| UX-002 | `gate-01-editor-workbench.png` (~780 px), `diff-01-loaded-workbench.png` (~990 px), `edit-01-dirty-webview.png` (~1,076 px) | confirmed, widened to the editor toolbar |
| UX-004 | `edit-01-dirty-webview.png` | confirmed |
| UX-006 | `gate-01-editor-webview.png`, `edit-01-dirty-webview.png` | confirmed visually |
| UX-008 | `merge-02-copied-workbench.png`, `merge-03-save-paths-workbench.png`, `driver-report.json` → `merge` | confirmed |
| UX-009 | `missing-engine/first-02-missing-engine-workbench.png`, `missing-engine/driver-report.json` | confirmed |
| UX-010 | `entry-16-stale-first-workbench.png`, `driver-report.json` → `stale-first` | confirmed, medium confidence |
| UX-011 | `save-continuity-before-webview.png` (Details `P99`), `save-continuity-after-webview.png` (Details `P85`), `driver-report.json` → `save-continuity` | new, high confidence |
| MERGE-10 | `merge-10-stale-workbench.png` | not reproduced (race lost) |

UX-003 and UX-007 are recorded as limitations, not scored findings (see their Disposition
sections).


