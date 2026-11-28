# Results — polish UX chrome and errors

Branch `fix/polish-ux-chrome-errors`, worktree
`H:\workspace\arxml-scope-worktrees\polish-ux-chrome-errors`.

## Findings → change → evidence

| Finding | Change | Evidence |
|---|---|---|
| UX-03 sidebar toggle weight | `#toggle-sidebar` gets `.tool-quiet`; `.tool-quiet[aria-pressed="true"]` uses `--vscode-toolbar-activeBackground`, never the `inputOption` option fill. `aria-pressed`/title/`aria-label` unchanged. | `src/test/webview/components/toolbar.test.ts` (class + CSS rule), `sidebar.test.ts`, `uxDocument.test.ts`; preview `editor` pressed fill measured as `rgb(42, 45, 46)` (`measure-toggle.mjs`), not the `#094771` option fill; preview `editor`, `editor-dirty` |
| UX-04 labels dropped at 1024/1082 | Secondary labels drop first from 1041 px; Context/Semantic/Strict/Merge/Swap sides keep labels. Icon-only step stays at ≤1040 px. At 1082 px the left group is 588 px with 358 px free and Merge is labelled. | `research/evidence/toolbar-1082.json`; preview `toolbar-1400/1200/1024/900/800/640` audits |
| UX-05 default/Context/count | Documented default stays **Show all**. Context is disabled **and** `aria-pressed="false"` while it cannot act; its preference returns with Show diff. A compact count (`4 changes (…)`) fills the existing `#diff-match-status` live region on open and after patches. Docs updated. | `research/evidence/diff-default.json`; `src/test/core/diffModel.test.ts`, `toolbar.test.ts`; host `diff` |
| UX-08 activation jargon/duplicate | Engine start errors are user-facing: no protocol constant, no `npm run engine:build`; internal detail goes to a lazily created `ARXML Scope` output channel. The extension no longer adds its own toast, so VS Code's single activation notification remains. | host `missing-engine`: one ARXML notification, 3/3 checks; `engine.test.ts`, `planEnginePackaging.test.ts` |
| UX-09 find count `? of N` | After an engine result restarts the native find widget, the bridge selects the nearest match (`moveToNextMatch`) so the count is numeric; the restart still targets the same hit. | host `diff`: `findCount: "1 of 3"`; `findBridge.test.ts` |
| UX-11 gate promises an editor | The open command now shows the text editor after a gate refusal and says so; the shared gate copy states the fact without an unfulfilled promise. Provider path still opens the text editor via `openWith default`. | host `first-gate` 3/3 (each file has a text tab) |
| UX-12 diff stale-side copy | A diff-specific notice names the stale side, says the comparison stopped updating, keeps the last good result and offers **Reload comparison** (new `reload` page→host message). | host `diff-side-not-ecuc` 3/3; `src/host/diffPanel.ts` |
| UX-13 merge module refusal | The refusal names the module (`"ColX" (/P/ColX)`) and the target side and offers **Reveal module**, which reuses the existing `reveal` message to open the module row in source. | host `merge-collision` 4/4; `compare.test.ts` source contract |
| UX-14 index skip reason | Per-file `IndexSkipReason` (`too-large` / `unsupported-encoding` / `unreadable`); the tooltip groups by reason and names the cap (`over arxmlScope.index.maxFileSizeMB = 1 MB`). A workspace containing only skipped files now keeps the status item so the reason is visible. | host `index-toggles` (capped tooltip); `planIndexValidation.test.ts` (size + encoding) |
| UX-15 `replace` reveal | `replace` closes this file's ECUC editor tab after showing the text editor, leaving one tab; docs say so. | `uxReveal.test.ts` (replace closes the custom tab); host `reveal-modes` blocked — see below |
| UX-16 dirty status shift | The status moved after Collapse/Expand, before the flexible gap, so only free space shrinks. Cross-state probe: both buttons keep x=8 and x=74. | `research/evidence/state-diff-editor.json` (0 px delta); `toolbar.test.ts` order assertion |

## Verification

- `npm run check-types` — pass
- `npm run lint` — pass (design lint: 0 errors/warnings)
- `npm test` — 953 passing, 0 failing
- `npm run engine:smoke` — exit 0
- `npm run rust:test` — pass
- Preview: `toolbar-1400/1200/1024/900/800/640`, `editor`, `editor-dirty`, `diff-off` (and all other seeded states except the two below) — audits clean
- Host (`HOST_OUT` = this directory):
  - `diff`, `first-gate`, `diff-side-not-ecuc`, `merge-collision`, `index-toggles` — all checks pass, no driver errors (`research/host/driver-report.json`)
  - `missing-engine` — 3/3 checks, one user-facing notification (`research/host-missing-engine/driver-report.json`)

## Blockers / known limits

1. **`reveal-modes` host scenario**: the replace-mode product behavior is correct (the
   custom tab is gone; `uxReveal.test.ts` proves it), but the driver crashes at
   `activeIn(frame)` after the click because closing the ECUC tab closes the webview
   frame. The scenario marks `ok:false` with
   `frame.evaluate: Target page, context or browser has been closed`
   (`research/host/driver-report.json`). It needs a driver guard such as evaluating
   `activeIn(frame)` only while the active tab is still the custom editor. The shared
   skill was not edited per the task instructions.
2. **`diff-collapse-all` preview state**: fails on this machine with
   "Collapse All left … expanded" both with this branch and on the pristine baseline
   (verified via a temporary `git stash` build), so it is runner/environment
   nondeterminism, not a regression. `diff-collapsed` remains the documented runner
   limit.
3. **`diff-swap`** preview state flaked once (gutter items) and passed on two
   consecutive re-runs; treated as the same runner nondeterminism.
