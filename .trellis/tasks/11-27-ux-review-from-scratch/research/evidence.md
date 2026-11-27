# Evidence index — UX review (fresh run)

Task: `.trellis/tasks/11-27-ux-review-from-scratch`
Branch: `feat/ux-review-from-scratch`
Date: 2026-11-27
Reviewer: `ux-reviewer` subagent (Phases 1–3 and the Phase 4–5 report)

Everything below was produced by this run. No artifact, measurement or verdict is copied from
the archived review.

## Environment

| Item | Value |
|---|---|
| OS | Windows (win32) |
| Browser used by the preview runner | `C:/Program Files/Google/Chrome/Application/chrome.exe` |
| Preview bundle | `dist/` present (`dist/monaco.worker.js`, 638,300 bytes); rebuilt with `node esbuild.js` before the host pass |
| Zoom | browser zoom not set by the runner; the audit's toolbar rect (588 CSS px) matches 588 PNG px, so the captures are **1 CSS px : 1 image px (DPR 1)** |
| Theme | preview seeds the dark VS Code token set (the harness does not render light/high-contrast) |

## Commands

```powershell
# 1. list the seeded states (returned 43)
node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --list

# 2. capture every seeded state (43/43, one retry on diff-collapse-all)
node .agents/skills/ux-review/scripts/preview/shotWebview.mjs

# 3. retry the one state whose first audit reported violations
node .agents/skills/ux-review/scripts/preview/shotWebview.mjs --state diff-collapse-all

# 4. copy the PNG + audit for each state into this task
Copy-Item .agents/skills/ux-review/artifacts/*.png        research/evidence/preview/ -Force
Copy-Item .agents/skills/ux-review/artifacts/*.audit.json research/evidence/preview/ -Force
```

## Capture conditions (fidelity)

- Each state requests a page of `width × 900`; the PNG is exactly that size.
- The page's own audit reports `window.innerWidth × innerHeight` = **`width − 16` × 805** for every
  state. The two figures are recorded side by side below; this report always names which one it uses
  and never presents a preview width as a VS Code host width.
- The preview is a standalone page: no VS Code tab strip, status bar, notifications, sidebar viewlet
  or auxiliary bar. A realistic 1440×900 workbench leaves roughly 780–1080 CSS px for the webview, so
  the 1400/1200/1024 previews prove the *breakpoint logic*, not a host-parity layout.
- `diff-collapse-all` flaked once: the first capture reported
  `["Collapse All left the left-only container expanded", "Collapse All left a shared container expanded"]`.
  The immediate retry of the same state reported `violations: []`. Per the skill's flake rule this is
  recorded as a retry, not as a page defect; the host pass must re-test Collapse All.
- All 43 committed audits have `violations: []`, `overlaps: []`, `outside: []`, `clipped: []` and
  `pageOverflow: false`. Audits were read before the PNGs: first the key fields of all 43, then the
  full audit of `editor`, `editor-invalid`, `editor-details`, `editor-stale-save`, `editor-copied`,
  `editor-find`, `editor-sticky`, `diff-off`, `diff-merge`, `diff-swap`, `diff-copied`,
  `diff-collapse-all`, `toolbar-1400/1024/640`.

## Preview artifact index

Files: `research/evidence/preview/<state>.png` and `<state>.audit.json`.

| State | PNG | Audit viewport (CSS) | Page | Controls | Violations |
|---|---|---|---|---|---|
| `diff-off` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `diff-collapsed` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `diff-collapsed-onesided` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `diff-collapse-all` | 1400×900 | 1384×805 | diff | 11 | 0 (after retry) |
| `diff-merge` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `diff-copied` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `diff-swap` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `diff-rail` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `diff-nav` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `diff-sticky` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `diff-one-sided` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `diff-removed` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `diff-added` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `diff-sash` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `diff-wide` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `diff-wide-panned` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `editor` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-syntax` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-syscond` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-labels` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-dirty` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-copied` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-invalid` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-details` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-details-save` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-details-undo` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-details-redo` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-delete` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-details-rename` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-rename-refusal` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-rename-late-ack` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-multi-save` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-paste` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-stale-save` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-sticky` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `editor-find` | 1400×900 | 1384×805 | editor | 3 | 0 |
| `diff-find` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `toolbar-1400` | 1400×900 | 1384×805 | diff | 11 | 0 |
| `toolbar-1200` | 1200×900 | 1184×805 | diff | 11 | 0 |
| `toolbar-1024` | 1024×900 | 1008×805 | diff | 11 | 0 |
| `toolbar-900` | 900×900 | 884×805 | diff | 11 | 0 |
| `toolbar-800` | 800×900 | 784×805 | diff | 11 | 0 |
| `toolbar-640` | 640×900 | 624×805 | diff | 11 | 0 |

Measured toolbar geometry at every width (`audit.toolbar.groups.left`):

| State | Toolbar-left width (CSS px) | Overlaps | Outside | Clipped |
|---|---|---|---|---|
| `toolbar-1400` | 588 | 0 | 0 | 0 |
| `toolbar-1200` | 588 | 0 | 0 | 0 |
| `toolbar-1024` | 475 | 0 | 0 | 0 |
| `toolbar-900` | 416 | 0 | 0 | 0 |
| `toolbar-800` | 364 | 0 | 0 | 0 |
| `toolbar-640` | 312 | 0 | 0 | 0 |

## State → journey mapping

| Journey rows | States |
|---|---|
| ENTRY-01/02, EDIT-01…03 | `editor`, `editor-labels`, `editor-syntax` |
| EDIT-04, EDIT-08 | `editor-dirty`, `editor-multi-save` |
| EDIT-05 | `editor-invalid` |
| EDIT-06, CONT-02, CONT-10 | `editor-details`, `editor-details-save` |
| EDIT-07 | `editor-details-undo`, `editor-details-redo`, `editor-delete` |
| EDIT-09/10/11 | `editor-details-rename`, `editor-rename-refusal`, `editor-rename-late-ack` |
| EDIT-14 | `editor-stale-save` |
| EDIT-15 | `editor-paste` |
| EDIT-18 | `editor-find` |
| EDIT-20 | `editor-sticky` |
| EDIT-23 (Details half only) | `editor-syscond` |
| MERGE-08 (editor half) | `editor-copied` |
| DIFF-01 | `diff-off` |
| DIFF-03, A11Y-05, A11Y-08 | `toolbar-1400`…`toolbar-640` |
| DIFF-05 | `diff-nav`, `diff-rail` |
| DIFF-06 | `diff-collapsed`, `diff-collapsed-onesided`, `diff-collapse-all` |
| DIFF-07 | `diff-swap` |
| DIFF-09 | `diff-find` |
| DIFF-10 | `diff-sash` |
| DIFF-11 | `diff-sticky` |
| DIFF-12 | `diff-wide`, `diff-wide-panned` |
| DIFF-13 | `diff-one-sided`, `diff-added`, `diff-removed` |
| MERGE-01/02/03 | `diff-merge`, `diff-one-sided` |
| MERGE-08 (diff half) | `diff-copied` |

## Preview gaps (rendered work with no seeded state)

| Journey | Missing state | Why it matters |
|---|---|---|
| EDIT-12/13 | Duplicate/Delete row menu and its confirmation | The only structural-edit UI; unproven in preview and host |
| EDIT-16/17 | Read-only file, CDATA value | Two refusal surfaces with no visual evidence |
| EDIT-19 | A statically folded container (margin dot) | `diff-collapsed` ends expanded; the folded screenshot is missing |
| EDIT-23 | The **Conditions tab** (add/save/cancel/clear/invalid) | Only the Details condition field is seeded |
| EDIT-24/25 | Jump to target, Find references Quick Pick, reveal modes | Navigation confirmations and focus behaviour |
| EDIT-28 | Sidebar hidden / full-width Document | Layout and the toggle's off state |
| DIFF-02 | Loading comparison | The anti-flash "Loading comparison…" state |
| DIFF-04 | Show diff + hidden unchanged regions + Context off | The primary review mode is never captured; only Show all is |
| DIFF-08 | Semantic→Strict pending spinner/status | The transition state and its `aria-busy` |
| DIFF-14/15/17 | Identical files, side stops being ECUC, refresh error | Empty/notice states |
| MERGE-06/07 | Module-collision refusal, stale-snapshot modal | Two safety-critical refusals |
| FIRST-03 | Empty / malformed ECUC file | The first-run gate has no state |
| A11Y-03/04/06 | Light and high-contrast themes, reduced motion | The preview seeds dark tokens only; host check required |
| INDEX/ENGINE/SET surfaces | — | Status bar, Problems, settings and engine are host-only |

## Host evidence

Run in the real Extension Development Host (`@vscode/test-electron` + Playwright over CDP to the
nested `active-frame`). Eight launches: thirteen first-pass scenarios, one `missing-engine` launch,
and one consolidated deep-discovery launch with 19 new scenarios. Full verdicts and N/A reasons:
`research/host-runs.md`.

| # | `UX_HOST_ONLY` | Report | PNGs |
|---|---|---|---|
| 1 | `gate` | `driver-report-gate.json` (and `driver-report.json`) | `gate-01-*`, `gate-02-*` |
| 2 | `capture-fidelity,edit,save-continuity` | `driver-report-r1.json` | `capture-zoom-*`, `edit-01/02-*` |
| 3 | `capture-fidelity` (retry) | `driver-report-r1b.json` | `capture-zoom-*-b.png` |
| 4 | `diff,merge,stale-copy,stale-node` | `driver-report-r2.json` | `diff-01…04-*`, `merge-01/02/03/10-*`, `edit-16-stale-*` |
| 5 | `engine-index,a11y,stale-first,same-file,compare-two` | `driver-report-r3.json` | `engine-01-*`, `index-04-*`, `a11y-01…03-*`, `entry-16-*`, `entry-24-*`, `entry-20-*` |
| 6 | `UX_HOST_MODE=missing-engine` | `driver-report-missing-engine.json` | `first-02-missing-engine-*` |
| 7 | `save-continuity` (corrected probe) | `driver-report-save-continuity-fixed.json` | `save-continuity-before/after-*` (replaced) |
| 8 | 19 deep-discovery scenarios | `driver-report-deep-all.json` | `deep-*` |

`host-run*.json` and `host-activation*.json` are kept per launch (base name = launch 1).

### Measured sizes and zoom

| Capture | Workbench | Webview frame (CSS px) | DPR | Zoom |
|---|---|---|---|---|
| `gate-01-editor` | 1440×900 | 1082×777 | 1 | 0 |
| `gate-02-diff` | 1440×900 | 1082×799 | 1 | 0 |
| `capture-zoom-100` | 1440×900 | 1082×777 | 1 | 0 |
| `capture-zoom-80` | 1728×1080 | **1369×949** | 0.833 | 0 (`zoomLevel` unchanged) |
| `edit-01/02` | 1440×900 | 786×777 | 1 | 0 |
| `save-continuity` (corrected) | 1440×900 | 1082×777 | 1 | 0 |
| `merge-01/02` | 1440×900 | 786×799 | 1 | 0 |
| `edit-16-stale` | 1440×900 | 786×777 | 1 | 0 |
| `diff-01…04`, `merge-10` | 1440×900 | 1082×799 | 1 | 0 |
| `a11y-01/02` | 1440×900 | 1082×777 | 1 | 0 |
| `a11y-03` | 1440×900 | 1082×799 | 1 | 0 |
| `first-02-missing-engine` | 1440×900 | n/a | 1 | 0 |
| `deep-*` editor/diff (16 captures) | 1440×900 | 1082×777 / 1082×799 | 1 | 0 |
| `deep-reveal-beside/reverse` | 1440×900 | **541×777** (editor split) | 1 | 0 |
| `deep-theme-light/hc` | 1440×900 | 1082×481 (Output panel open) | 1 | 0 |
| `deep-theme-zoom150` | 1000×625 (device 1440×900) | **642×207** | 1.44 | 150 % |

Width-sensitive statements use **1082 px (100 %)** and **1369 px (80 %)**. The 786 px group ran
with the Chat/auxiliary bar open (content evidence only).

### Commands

```powershell
node esbuild.js
node scripts/build-engine.mjs --debug

$env:HOST_OUT='.trellis/tasks/11-27-ux-review-from-scratch/research/evidence/host'
$env:UX_HOST_ONLY='gate'
node .agents/skills/ux-review/scripts/host/run.mjs
# … capture-fidelity,edit,save-continuity · diff,merge,stale-copy,stale-node ·
#    engine-index,a11y,stale-first,same-file,compare-two
# corrected, click-free save probe (CONT-01):
$env:UX_HOST_ONLY='save-continuity'
node .agents/skills/ux-review/scripts/host/run.mjs
# deep-discovery pass (19 scenarios, one launch):
$env:UX_HOST_ONLY='edit-invalid,edit-details-save,edit-multi-save,row-menu,conditions-tab,reveal-modes,find-replace,settings-sort,diff-collapse-all,diff-showdiff-swap,diff-identical,diff-side-not-ecuc,merge-collision,merge-subtree,merge-off,index-toggles,engine-restart,theme-zoom,first-gate'
node .agents/skills/ux-review/scripts/host/run.mjs
$env:UX_HOST_MODE='missing-engine'
node .agents/skills/ux-review/scripts/host/run.mjs
Remove-Item Env:HOST_OUT, Env:UX_HOST_ONLY, Env:UX_HOST_MODE
```

### Host caveats (recorded, not fixed)

1. **Fixed during the review (harness, not product).** The original `save-continuity` probe clicked
   the editor centre before `Ctrl+S`, moving the selected row (P99 → P85). The driver now saves
   without that click and compares the selected node; the corrected run passes 7/7 with
   `P99 → P99`. The earlier selection change is not a finding.
2. The scenario's `scrollTop` metric always reads 0 (wrong scrollable element); anchor lines are
   the reliable measure, so an exact `scrollTop` number is not recorded.
3. `reset()` toggles the auxiliary bar unconditionally, so some captures have Chat open (786 px).
4. Element screenshots at 80 % zoom are mis-clipped; the workbench capture at 80 % is correct.
5. `merge-03-saved` was captured at 300×150 (resize race) and is not used; use
   `merge-03-save-paths-workbench.png`.
6. `stale-copy` did not reproduce (the click target moved after the external replace);
   MERGE-07 is `N/A`.
7. No host process, Chrome or bridge was left running; the temp workspace/profile were removed by
   the runner and checked afterwards.

## Final artifact index

| Artifact | Path |
|---|---|
| Report | `research/UX_REVIEW.md` |
| Journey matrix (135 rows) | `research/journeys.md` |
| Host run log and per-journey verdicts | `research/host-runs.md` |
| Findings (15) | `research/findings/` (UX-01 … UX-15) |
| Preview captures + audits (43 + 43) | `research/evidence/preview/` |
| Host captures + JSON (68 files) | `research/evidence/host/` |

### Findings evidence map

| Finding | Primary evidence |
|---|---|
| UX-01 Major | `research/evidence/preview/editor-invalid.png`, `editor-rename-refusal.png` |
| UX-02 Major | `research/evidence/host/edit-16-stale-workbench.png`, `research/evidence/preview/editor-stale-save.png`, `driver-report-r2.json` |
| UX-03 Minor | `research/evidence/host/capture-zoom-100-webview.png`, `edit-16-stale-workbench.png`, `research/evidence/preview/editor.png` |
| UX-04 Minor | `research/evidence/host/gate-02-diff-workbench.png`, `diff-01-loaded-webview.png`, `research/evidence/preview/toolbar-1024.png`, `toolbar-1200.png` |
| UX-05 Minor | `research/evidence/host/diff-01-loaded-webview.png`, `research/evidence/preview/diff-off.png`, `toolbar-1400.png` |
| UX-06 Major | `research/evidence/host/merge-02-copied-workbench.png`, `merge-03-save-paths-workbench.png`, `driver-report-r2.json` |
| UX-07 Major | `research/evidence/host/entry-16-stale-first-workbench.png`, `driver-report-r3.json` |
| UX-08 Minor | `research/evidence/host/first-02-missing-engine-workbench.png`, `driver-report-missing-engine.json` |
| UX-09 Minor | `research/evidence/host/diff-03-find-workbench.png`, `driver-report-r2.json` |
| UX-10 Major (Floor contrast) | `research/evidence/host/deep-theme-light-webview.png`, `driver-report-deep-all.json` (`theme-zoom.toolContrast: 3.1`) |
| UX-11 Minor | `research/evidence/host/deep-first-gate-workbench.png`, `driver-report-deep-all.json` (`first-gate`) |
| UX-12 Minor | `research/evidence/host/deep-diff-side-not-ecuc-webview.png`, `driver-report-deep-all.json` (`diff-side-not-ecuc`) |
| UX-13 Minor | `research/evidence/host/deep-merge-collision-workbench.png`, `driver-report-deep-all.json` (`merge-collision`) |
| UX-14 Minor | `research/evidence/host/deep-index-toggles-workbench.png`, `driver-report-deep-all.json` (`index-toggles.capped.text`) |
| UX-15 Minor | `research/evidence/host/deep-reveal-replace-workbench.png`, `driver-report-deep-all.json` (`reveal-modes.modes.replace`) |

### Deep discovery evidence

`driver-report-deep-all.json` covers 19 scenarios: `edit-invalid`, `edit-details-save`,
`edit-multi-save`, `row-menu`, `conditions-tab`, `reveal-modes`, `find-replace`, `settings-sort`,
`diff-collapse-all`, `diff-showdiff-swap`, `diff-identical`, `diff-side-not-ecuc`,
`merge-collision`, `merge-subtree`, `merge-off`, `index-toggles`, `engine-restart`, `theme-zoom`,
`first-gate`. Captures are `research/evidence/host/deep-*.png`.
The path matrix and remaining gaps are in `research/deep-discovery.md`.

### Continuity evidence

| Probe | Captures | Result |
|---|---|---|
| CONT-01 save continuity | `save-continuity-before-webview.png`, `save-continuity-after-webview.png`, `driver-report-save-continuity-fixed.json` | pass: `P68 = 68` … `}`, Details `P99 → P99`, value `99 → 91`, focus `native-edit-context`, dirty cleared |

### Coverage limits (recorded, not findings)

- Native Delete/Duplicate confirmation could not be observed over CDP; `row-menu` is not scored.
- Native find inputs sit in a closed shadow root; the widget text is readable, the input is not.
- `stale-copy` did not reproduce; MERGE-07 is `N/A`.
- Screen-reader output, reduced motion, packaged VSIX and multi-root workspaces remain unrun.
- The 786 px host captures ran with Chat open; width statements use 1082 px and 1369 px only.
- 80% element screenshots mis-clip; workbench captures are used for width/zoom claims.

