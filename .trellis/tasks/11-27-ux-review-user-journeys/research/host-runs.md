# Host runs — Phase 3 evidence

Status: two normal runs (13 and 14 scenarios) plus one missing-engine run. Every listed
screenshot/JSON is under `research/evidence/host/`. The final full-run report is
`driver-report.json`; the missing-engine run has its own directory. The runner is the reusable
`ux-review` skill at `.agents/skills/ux-review/scripts/host/`; this task keeps the evidence.

## Environment

| Item | Value |
|---|---|
| VS Code under test | `1.147.0` (`C:\Users\tripm\AppData\Local\Programs\Microsoft VS Code\Code.exe`) |
| Node | `26.13.1` |
| Extension id | `deviousprophet.vscode-arxml-scope` (development path = repo root) |
| Engine | `dist/engine/win32-x64/arxml-engine.exe`, debug build |
| Workspace | fresh `%TEMP%\arxml-ux-host-ws-*`, copied from `src/test/fixtures/diff/{left,right}.arxml` plus generated empty/non-ECUC/malformed files |
| Profile | fresh `%TEMP%\arxml-ux-host-profile-*`, deleted after the run |
| Playwright | resolved from `packages/webview-preview/package.json` via `createRequire`; CDP over `--remote-debugging-port` |
| Target | nested `vscode-webview://…` frame named `active-frame` |

## Runner

| File | Role |
|---|---|
| `.agents/skills/ux-review/scripts/host/run.mjs` | temp workspace + `@vscode/test-electron` launch + cleanup; `UX_HOST_MODE=missing-engine` hides the engine binary and restores it in `finally` |
| `.agents/skills/ux-review/scripts/host/suite.cjs` | in-host: activate, localhost bridge (`/exec`, `/openWith`, `/openText`, `/closeAll`, `/setting`, `/config`, `/state`, `/writeFile`, `/readFile`, `/replaceDocument`, `/vscodeDelete`, `/save`, `/saveAll`, `/hasCommand`), spawn driver |
| `.agents/skills/ux-review/scripts/host/driver.mjs` | Playwright: frame targeting, real clicks/typing/shortcuts, screenshots, per-scenario report |

Reproduce:

```powershell
node esbuild.js
node scripts/build-engine.mjs --debug
$env:HOST_OUT='.trellis/tasks/11-27-ux-review-user-journeys/research/evidence/host'
node .agents/skills/ux-review/scripts/host/run.mjs
$env:UX_HOST_MODE='missing-engine'; node .agents/skills/ux-review/scripts/host/run.mjs
```

## Gate — primary journey end to end

`gate` scenario **passed** (6.2 s):

1. `left.arxml` opened in the ECUC editor (tab viewType `vscode-arxml-scope.ecucEditor`).
2. Clicking `ContKeep` populated Details (`container / ContKeep / Short name / Definition`).
3. `Select as First File to Compare` then `Compare with First File` opened the diff webview.
4. The diff names `left.arxml` and `right.arxml` and renders `.monaco-diff-editor`.

Evidence: `gate-01-editor-*.png`, `gate-02-diff-*.png`.

## Journey results

| Journey | Verdict | Evidence | Expected vs actual / note |
|---|---|---|---|
| ENTRY-01 | good | `gate-01-editor-*` | ECUC editor opens from the command; module rows and Details render. |
| ENTRY-14 | good | `gate-02-diff-*` | Select-as-first then compare-with-first stashes and opens the pair. |
| ENTRY-17 | good | `gate-02-diff-*` | First file is the left side; stash cleared after the compare (context key not re-read). |
| ENTRY-20 | good | `entry-20-compare-two-*` | Two-file compare opens the same pair with both labels. |
| EDIT-01 | good | `edit-01-dirty-*` | `ArrowDown` twice moved Details from `ContKeep` to `Changed`; row selection follows. |
| EDIT-02 | good | `gate-01-editor-*` | Details is populated from the row, not from a DOM read. |
| EDIT-03 | good (with UX-004) | `edit-01-dirty-*` | Inline typing marked the page `● Unsaved changes`; Details value became `7`. |
| EDIT-16 | **friction** | `edit-16-stale-*` | Save refused after the row disappeared; only `#details-status` says `The node is no longer in the file.`; dirty strip stays. Confirms **UX-001**. |
| EDIT-19 | good | `edit-02-saved-*` | `Ctrl+S` cleared the dirty strip and wrote `Keep = 7` to `left.arxml`. |
| EDIT-40 | **friction** | `save-continuity-before-*`, `save-continuity-after-*` | A large document was scrolled to the bottom, `P99` was edited and saved. Scroll (`P68 = 68` … `}`) and focus (`native-edit-context`) survived, but Details moved from `P99` to `P85` while the write succeeded. New **UX-011**. |
| DIFF-01 | good | `diff-01-loaded-*` | 11 toolbar controls, semantic default, both panes painted. |
| DIFF-03 | good | `diff-02-strict-*` | Strict flips `aria-pressed`; status text clears after the rebuild. |
| DIFF-06 | good | `diff-03-find-*` | `Ctrl+F` + `ContKeep` reports matches (`? of 3` through the icon font); no rows hidden. |
| DIFF-07 | good | `diff-04-next-long-*` | On a generated 300-row diff, Next diff jumped from the module header to `P232 = 232`. |
| MERGE-01 | good | `merge-01-on-*` | Merge toggles on; hunk copy actions are available. |
| MERGE-02 | good | `merge-02-copied-*` | Copy-to-right dirtied `right.arxml`; pane label `right.arxml •`; separate `right.arxml ●` tab appeared. |
| MERGE-14 | good | `merge-02-copied-*` | Both the pane bullet and the tab bullet are visible. |
| MERGE-15 | **friction** | `merge-02-copied-*`, `merge-03-save-paths-*` | `Ctrl+S` while the diff has focus does **not** save; switching to the `right.arxml` tab and pressing `Ctrl+S` saves; Save All also saves. New **UX-008**. |
| MERGE-10/11/12/13 | N/A - guard not reproduced | `driver-report.json` → `stale-copy` | A version bump 150 ms before the copy always refreshed first; no Reload/Cancel modal was observed. Do not infer the guard works. |
| ENGINE-01 | good | `engine-01-status-workbench.png` | Notification: `ARXML Scope engine running, pid …` with **Restart Engine** / **Open Output**; output lists state, version, protocol, pid, uptime, restarts, open docs, pending, memory, last error. |
| ENGINE-04 / FIRST-02 | **broken** | `missing-engine/first-02-missing-engine-workbench.png` | Activation fails. Toast is truncated and developer-facing (`run "npm run engine:build"`, `(1 is the host protocol)`). No ARXML command is registered. New **UX-009**. |
| INDEX-01 | good | `engine-01-status-workbench.png` | Status bar: `ARXML Scope: 7 files indexed · cross-file checks off (no project)`. |
| INDEX-04 | good | `index-04-rebuilt-*` | Rebuild completes; count stays 7. |
| A11Y-01 | good | `a11y-01-palette-*` | `Ctrl+Shift+P` → command name → `Enter` opens the ECUC editor without a pointer. |
| A11Y-02 | **friction (partial)** | `a11y-02-editor-focus-*` | Toolbar order `collapse-all → expand-all → toggle-sidebar`, then Monaco's `native-edit-context` three times. The rotated Details/Conditions tabs are not reachable by plain `Tab`; F6/command paths were not tested. |
| A11Y-03 | good | `a11y-03-diff-focus-*` | 11 controls in visual order (`diff-view-all … diff-expand-all`), then the pane editors. |
| ENTRY-16 | **friction** | `entry-16-stale-first-*` | First file was deleted (`existsAfterDelete=false`), yet the diff opened with its cached text and no warning. New **UX-010**. |
| ENTRY-24 | **friction** | `entry-24-same-file-*` | Same file twice is refused with `Select exactly two .arxml files to compare.`; the message does not say the cause is the same file. |

## Scenario report

`driver-report.json` (normal run): 14 scenarios, 10 pass; the four non-passing scenarios are the
known findings/gaps below, not launch failures.

| Scenario | Checks | Result |
|---|---|---|
| gate | 6 | all pass |
| probe-diff | diagnostics | DOM probe only |
| capture-fidelity | 2 | all pass; 100% frame 786×777, 80% frame 1074×949, DPR 0.833 |
| edit | 5 | all pass |
| save-continuity | 6 pass, 1 fail | **UX-011** (Details `P99` → `P85`) |
| compare-two | 2 | all pass |
| diff | 5 | all pass |
| merge | 5 pass, 2 fail | **UX-008** |
| stale-copy | 1 fail | not reproduced |
| stale-node | 2 pass | **UX-001 confirmed** |
| engine-index | 3 pass | ENGINE-01, INDEX-01/04 |
| a11y | 3 pass | keyboard evidence |
| stale-first | 1 pass, 1 fail | **UX-010** |
| same-file | 1 pass | generic refusal |

Missing-engine run: 3/3 checks pass and prove the failure; the check names are positive
("a startup error is shown") because the finding is the **quality and persistence** of that
error, not its absence.

## Findings — confirmed / refuted / new

| Finding | Status | Host evidence |
|---|---|---|
| UX-001 stale save only in Details status | **confirmed** | `edit-16-stale-*`; `The node is no longer in the file.` only in the bottom-right status; dirty strip remains. |
| UX-002 toolbar labels vanish at narrow widths | **confirmed and widened** | `gate-01-editor-workbench.png` (~780 px) and `diff-01-loaded-workbench.png` (~990 px): all icon-only. At ~1076 px (`edit-01-dirty-*`) the editor labels are back. The editor toolbar is affected too, not just the diff. |
| UX-003 copied rows lack the page-level unsaved strip | dropped as limitation | Copied-row markers are a deliberately distinct signal; pane bullet + dirty tab cover the unsaved state. |
| UX-004 derived integer formats do not follow the draft | **confirmed** | `edit-01-dirty-webview.png`: Value `7`, Decimal `1`, Hexadecimal `0x01`, Binary `0b00000001`. |
| UX-005 rename refusal generic strip | not re-run | Needs the rename flow; remains preview-only. |
| UX-006 rotated sidebar tabs | **confirmed visually** | `gate-01-editor-webview.png`, `edit-01-dirty-webview.png`. |
| UX-007 merge overflow menu covers rows | dropped as limitation | Native Monaco placement; not reproduced as an obstruction in the host. |
| UX-008 `Ctrl+S` in the diff does not save the copy | **new / confirmed** | `merge-02-copied-*`, `merge-03-save-paths-*`; tab save and Save All both work. |
| UX-009 missing-engine activation message is developer-facing and truncated | **new / confirmed** | `missing-engine/*`. |
| UX-010 deleted first file is compared from cached text with no warning | **new / medium** | `entry-16-stale-first-workbench.png`; `existsAfterDelete=false`, diff still opens. |
| UX-011 a successful save moves the selection to `P85` | **new / high** | `save-continuity-before-webview.png` (Details `P99`) → `save-continuity-after-webview.png` (Details `P85`); scroll and focus preserved. |

## Not run in this pass

`ENTRY-05/06/07`, `ENTRY-15`, `ENTRY-21/23/25`, `EDIT-04/05/07/08/10/11…15/17/18/20…39`,
`DIFF-16/17/19`, `MERGE-04…09/16/18/20`, `INDEX-03/05…16`, `ENGINE-02/03/05/06/07`,
`SET-01…13`, `A11Y-04…08`, `FIRST-03…10` — **N/A** for this pass: preview already covers the
rendered editor/diff states for many of them; the rest need another host pass (settings,
dialogs, crash/restart, one-sided merge, other themes).

## Blockers and limitations

- **MERGE-10 stale guard** could not be raced: the diff's 150 ms refresh won every attempt. This
  is a gap, not a pass.
- The `--disable-extensions` dev host shows the "All installed extensions are temporarily
  disabled" toast and opens Chat; both were cleared before captures but Chat reopened in some
  runs, narrowing the webview. Widths quoted above are the observed webview widths.
- The bridge deletes files through `vscode.workspace.fs.delete`, but a document cached by
  `selectAsFirst` survives; UX-010 is marked medium for that reason.
- No Reload/Reload Window flow, no unsupported-platform run (only missing binary), no
  high-contrast or reduced-motion run.

## Cleanup

- Every `runTests` launch exited; the final check found no `Code.exe` process carrying
  `arxml-ux-host-profile` in its command line, and no `%TEMP%\arxml-ux-*` directory remained.
- The engine binary was restored after the missing-engine run
  (`dist/engine/win32-x64/arxml-engine.exe` present, 6,039,040 bytes).
- No repository file outside this task's `research/` tree was modified.

## Next recommendation

1. Fix **UX-009** first: it is the only `broken` journey and caps Flow efficiency. A persistent,
   plain-language activation error (and a supported-platform list) is the minimum.
2. Then **UX-008**: the diff needs the same page-level `Ctrl+S` handling the ECUC editor has, or
   the docs must stop implying that Save from the diff works.
3. Then **UX-001** (save refusal next to the row/save action) and the toolbar label loss
   (**UX-002**).
4. Rerun the stale guard with a deterministic hook (or a test seam) instead of a race.
