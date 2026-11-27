# Deep discovery — coverage matrix and gaps

Task: `.trellis/tasks/11-27-ux-review-from-scratch`
Pass: deep discovery on paths the first review did not exercise (2026-11-27)
Baseline: `research/UX_REVIEW.md` with 9 findings (UX-01…UX-09), overall 2.5
Result of this pass: **6 new findings** (UX-10…UX-15), overall 2.3, A11y capped at 2 by a Floor
contrast failure.

## Method and evidence

- **Host:** 19 new scenarios added to `.agents/skills/ux-review/scripts/host/driver.mjs`, run in one
  consolidated launch with `UX_HOST_ONLY` (scenario names below). Report:
  `research/evidence/host/driver-report-deep-all.json`. Screenshots `deep-*`.
- **Preview:** the existing 43 seeded states (no new state was needed); `research/evidence/preview/`.
- **Source:** read only to locate a cause or quote copy (paths cited per row).
- The host measured `page 1440×900`, webview `1082×777/799` at 100 %, `1369×949` at 80 % and
  `642 px` at 150 %; DPR 1 (0.833 at 80 %). The 786 px captures (Chat open) are content evidence
  only and are not used for width statements.

Command:

```powershell
$env:HOST_OUT='.trellis/tasks/11-27-ux-review-from-scratch/research/evidence/host'
$env:UX_HOST_ONLY='edit-invalid,edit-details-save,edit-multi-save,row-menu,conditions-tab,reveal-modes,find-replace,settings-sort,diff-collapse-all,diff-showdiff-swap,diff-identical,diff-side-not-ecuc,merge-collision,merge-subtree,merge-off,index-toggles,engine-restart,theme-zoom,first-gate'
node .agents/skills/ux-review/scripts/host/run.mjs
```

## Coverage matrix

### 1. ENTRY

| Path | Exercised | Method | Verdict | Evidence | Gap |
|---|---|---|---|---|---|
| Reveal in source, `beside` | yes | host `reveal-modes` | pass — ECUC stays active, source tab opens beside | `deep-reveal-beside-workbench.png` | — |
| Reveal in source, `focus` | yes | host | pass — source editor active | `deep-reveal-focus-workbench.png` | — |
| Reveal in source, `replace` | yes | host | **finding UX-15** — ECUC tab stays, two identical tabs | `deep-reveal-replace-workbench.png` | — |
| Reveal in ECUC (source → editor) | yes | host (focus mode, cursor on `ContKeep`) | pass — ECUC active, Details `ContKeep` | `deep-reveal-reverse-workbench.png` | — |
| Staged compare | yes | host `gate` (first pass) | pass | `driver-report-gate.json` | — |
| Compare two, cancel / one file | no | — | N/A | — | native open dialog is not scriptable |
| Compare two, non-ECUC | yes | host `first-gate` (non-ECUC) | **finding UX-11** (copy, not the gate itself) | `deep-first-gate-workbench.png` | picker path untested |
| Same file twice | yes | host `same-file` (first pass) | pass — warning, no tab | `entry-24-same-file-workbench.png` | — |

### 2. EDIT

| Path | Exercised | Method | Verdict | Evidence | Gap |
|---|---|---|---|---|---|
| Invalid value | yes | host `edit-invalid` | pass behavior; **UX-01 host-confirmed** (4 channels), save blocked, fix saves | `deep-edit-invalid-*.png` | — |
| Rename refusal | preview only | preview `editor-rename-refusal` | covered by UX-01; host path not driven | `evidence/preview/editor-rename-refusal.png` | host refusal needs a mock |
| Details-first save | yes | host `edit-details-save` | pass — file written, dirty cleared, focus + caret kept | `deep-edit-details-save-*.png` | — |
| Multi-field save | yes | host `edit-multi-save` | pass — both drafts in one save | `deep-edit-multi-save-*.png` | — |
| Duplicate / Delete | partial | host `row-menu` | menu + Quick Input pass; **modal confirmation not reachable** | `deep-row-menu-*.png` | native modal outside CDP |
| Undo / redo | no | preview | N/A (preview `editor-details-undo/redo`) | `evidence/preview/editor-details-*.png` | keys not host-driven |
| Paste | no | preview | N/A (preview `editor-paste`) | `evidence/preview/editor-paste.png` | OS clipboard |
| CDATA | no | — | N/A | — | no fixture/state |
| Read-only file | no | — | N/A | — | no fixture |
| Conditions add / invalid / save | yes | host `conditions-tab` | pass — commit `1`, 1→9 disabled, invalid name refused, manual row saved, Clear keeps rows | `deep-conditions-*.png` | — |
| Find / replace | partial | host `find-replace` | find opens; **finding UX-09** (`? of 1`); replace not drivable | `deep-find-*.png` | native widget closed shadow root |
| Fold / sticky (editor) | no | preview | N/A — preview states only | `evidence/preview/editor-sticky.png` | — |
| Reveal | yes | host `reveal-modes` | see ENTRY | `deep-reveal-*` | — |
| Settings re-render | yes | host `settings-sort` | pass — `all` → Alpha/Mu/Zeta, `declaration` → Zeta/Alpha/Mu live | `deep-settings-sort-*.png` | — |

### 3. DIFF

| Path | Exercised | Method | Verdict | Evidence | Gap |
|---|---|---|---|---|---|
| Collapse All | yes | host `diff-collapse-all` | **pass** — 58 → 8 → 58; preview flake not reproduced | `deep-diff-collapse-all-*.png` | — |
| Swap | yes | host `diff-showdiff-swap` | pass — titles mirror, state shown | `deep-diff-showdiff-*.png` | — |
| Semantic / Strict | yes | host `diff` (first pass) | pass — toggle flips | `driver-report-r2.json` | pending spinner not captured |
| Find count / current | yes | host `find-replace` + `diff` | **finding UX-09** — `? of 1`, `? of 3` | `deep-find-*`, `diff-03-find-*` | — |
| Show diff / Context | yes | host (400-param pair) | pass — 76 → 22 rows; Context enabled, then off; Show all restores | `deep-diff-showdiff-*.png` | Context-off row count unchanged (hidden regions are widgets) |
| Identical files | yes | host `diff-identical` | pass — "No differences", toolbar available | `deep-diff-identical-*.png` | empty copy is bare (Finish, not filed) |
| Side stops being ECUC | yes | host `diff-side-not-ecuc` | last good stays (pass), notice copy **finding UX-12** | `deep-diff-side-not-ecuc-*.png` | — |
| Refresh error | no | — | N/A | — | no fault injection |
| Close panel | yes | between scenarios | pass — no stray notifications | reports | — |
| Second comparison | no | — | N/A | — | not scripted |

### 4. MERGE

| Path | Exercised | Method | Verdict | Evidence | Gap |
|---|---|---|---|---|---|
| Module-collision refusal | yes | host `merge-collision` | pass behavior (nothing written); **finding UX-13** on copy | `deep-merge-collision-*.png` | — |
| Subtree copy | yes | host `merge-subtree` | pass — `Extra` + `<VALUE>5` written | `deep-merge-subtree-*.png` | — |
| Minimal ancestors | no | — | N/A | — | needs a deeper missing-parent fixture |
| Stale-snapshot Reload/Cancel | no | host `stale-copy` (first pass) | N/A — modal not reachable/reproduced | `merge-10-stale-*` | native modal + race |
| Range limits | no | — | N/A | — | — |
| Merge off | yes | host `merge-off` | pass — 0 visible copy actions, 5 on, 0 off | — | — |

### 5. INDEX

| Path | Exercised | Method | Verdict | Evidence | Gap |
|---|---|---|---|---|---|
| Enabled / disabled | yes | host `index-toggles` | pass — status hides when disabled, returns on enable | `deep-index-toggles-workbench.png` | `—` |
| Size cap | yes | host | pass — 16 → 15 with cap 1; **finding UX-14** on the reason copy | same | — |
| Exclude | yes | host | pass — 15 → 14, tooltip `1 file excluded` | same | — |
| Rebuild | yes | host | pass | same | — |
| Cross-file cycle | yes | host | pass — always → off → off (no project) | same | — |
| Text-editor symbols | no | — | N/A | — | outline/hover/links not scripted |
| No workspace | no | — | N/A | — | runner always opens a folder |
| Encoding | no | — | N/A | — | no encoding fixture |
| Huge file | yes | host | pass (indexed under 50 MB, skipped under 1 MB) | same | — |

### 6. ENGINE

| Path | Exercised | Method | Verdict | Evidence | Gap |
|---|---|---|---|---|---|
| Restart | yes | host `engine-restart` | pass — pid 4164 → 2980, `engine restarted` | `deep-engine-restart-workbench.png` | — |
| Restart failure | no | — | N/A | — | requires hiding the binary mid-run |
| Crash | no | — | N/A | — | killing the supervised process |
| Busy | no | — | N/A | — | no large-request fault |
| No health | no | — | N/A | — | — |

### 7. SETTINGS

| Setting | Exercised | Verdict | Evidence | Gap |
|---|---|---|---|---|
| `ecuc.editor.sort` | yes — all/declaration live | pass | `deep-settings-sort-*` | — |
| `ecuc.editor.sortExcept` | no | N/A | — | — |
| `ecuc.editor.revealMode` | yes — beside/focus/replace | pass / finding UX-15 | `deep-reveal-*` | — |
| `index.enabled` | yes | pass | `deep-index-toggles-*` | — |
| `index.maxFileSizeMB` | yes (1, 50) | pass + UX-14 | same | invalid `0`/negative not tested |
| `index.exclude` | yes | pass | same | malformed glob not tested |
| `validation.enabled` | no | N/A | — | fixtures produce 0 diagnostics |
| `validation.severities` | no | N/A | — | — |
| `validation.maxDiagnosticsPerFile` | no | N/A | — | — |
| `validation.maxDiagnostics` | no | N/A | — | — |
| `validation.crossFileRules` | yes — cycle | pass | `deep-index-toggles-*` | direct setting values not tested |
| `diff.semanticMatching` | no | N/A | — | no rename fixture pair |

### 8. ACCESSIBILITY

| Path | Exercised | Method | Verdict | Evidence | Gap |
|---|---|---|---|---|---|
| Light theme | yes | host `theme-zoom` | body 11.2:1 pass; **finding UX-10** toolbar labels 3.1:1 | `deep-theme-light-*` | diff labels at 1200 px not captured in light |
| High contrast | yes | host | pass — black/white body 21:1; layout intact | `deep-theme-hc-*` | control borders not measured |
| 80 % zoom | yes | host first pass | pass — frame 1369 px, workbench layout correct | `capture-zoom-80-workbench.png` | element screenshot mis-clipped |
| 150 % zoom | yes | host | pass — frame 642 px, 3 tools, no overlap/overflow | `deep-theme-zoom150-*` | diff toolbar at 150 % not captured |
| Reduced motion | no | — | N/A | — | OS setting |
| Screen-reader labels | partial | source/host | pass for toolbar (`aria-label`/`title`); not all controls audited | `a11y-03-*` | SR output not observable |
| Target sizes | partial | host 150 % | 28–40 px tools, no overlap; hit-area minimum not measured | `deep-theme-zoom150-*` | — |
| Focus order | yes | host `a11y` (first pass) | pass — editor and diff order; disabled Context skipped | `a11y-01…03-*` | ring visibility not captured |

### 9. FIRST RUN

| Path | Exercised | Method | Verdict | Evidence | Gap |
|---|---|---|---|---|---|
| Empty / malformed file | yes | host `first-gate` | ECUC gate pass; **finding UX-11** on the promise | `deep-first-gate-workbench.png` | — |
| Closed / deleted comparison file | yes | host `stale-first` (first pass) | **finding UX-07** | `entry-16-stale-first-workbench.png` | — |
| VSIX / unsupported platform | no | — | N/A | — | not packaged here |

## New findings

| Id | Gate | Severity | Surface |
|---|---|---|---|
| UX-10 | Floor — contrast | Major | Light-theme toolbar labels 3.1:1 |
| UX-11 | Reflex — truthful copy | Minor | Gate promise "showing the text editor" but none opens |
| UX-12 | Reflex — truthful copy | Minor | Diff stale-side notice reuses the gate copy |
| UX-13 | Reflex — recovery | Minor | Module-missing refusal names no module / no action |
| UX-14 | Finish — specific copy | Minor | Skipped-file tooltip lists three reasons |
| UX-15 | Reflex — duplicate state | Minor | `replace` reveal leaves the ECUC tab |

UX-09 was strengthened (editor find `? of 1`; host-confirmed on both surfaces) and UX-01 is now
host-confirmed. No existing finding was dropped or downgraded.

## Highest-risk gaps

1. **Native modal confirmations** (Delete, Duplicate confirmation, stale-snapshot Reload/Cancel)
   are not reachable over CDP: the row context menu and the Quick Input are visible, but the
   confirmation does not render in the captured page. The destructive-action copy and recovery
   remain unverified.
2. **Editor undo/redo, paste, CDATA, read-only** are preview/source-only; no host proof.
3. **Engine failure modes** (restart failure, crash, busy, no health) are unexercised.
4. **Validation settings** (enabled, severities, caps) are unexercised; the diff fixtures produce
   no diagnostics, so the Problems panel is not a useful probe.
5. **Text-editor symbols, no-workspace, encoding** and **packaged VSIX** remain unrun.
6. **Reduced motion and focus-ring visibility** are unverified; light-theme label contrast is now a
   confirmed failure.

## Harness notes

- Modal dialogs do not appear in the CDP page (`pages` stays at one; no `.monaco-dialog-box`), so
  `row-menu` and `stale-copy` end in a harness limitation, not a product verdict.
- The native find widget's inputs live in a closed shadow root: the count text is readable, the
  replace row is not drivable. Documented in `SKILL.md` with the new scenarios.
- `reset()` still toggles the auxiliary bar; the new scenarios call `ensureChatClosed()` and the
  captures record the real frame width.
