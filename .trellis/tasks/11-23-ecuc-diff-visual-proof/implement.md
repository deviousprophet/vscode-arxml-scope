# Implementation plan — diff body visual proof

## Branch gate

- [ ] Wait for PR #40 to merge to `main`.
- [ ] Body surface and unchanged/ruler children merged (or their final DOM/class contract stable).
- [ ] `git switch main && git pull`.
- [ ] Create `feat/ecuc-diff-visual-proof` from latest `main`.
- [ ] `task.py start 11-23-ecuc-diff-visual-proof` from that branch.
- [ ] Do not start from `feat/ecuc-vscode-parity`.

## Phase 0 — Reference capture

- [ ] Capture VS Code `^1.125` built-in diff body in Dark+, Light+ and HC smoke with the documented
      font/zoom/settings.
- [ ] Measure gutter, line number, margin, font/line height, indentation, unchanged-widget geometry,
      ruler and diff color roles.
- [ ] Write `docs/reference/diff-body/spec.json` and the capture README; check in the images.
- [ ] State the chrome-vs-content caveat: the reference is for the body chrome, not the ECUC
      semantic content.

## Phase 1 — Fixed state

- [ ] Add `diff-body-reference` to `previewData.ts` with changed/added/removed/renamed/one-sided/
      condition rows, Show diff + Context and merge mode.
- [ ] Ensure it uses no local sample files and no generated reference content.
- [ ] Expose the real models/body data for the audit.

## Phase 2 — Body audit

- [ ] Add `diffBodyAudit()` to `previewAudit.ts` reading the real Monaco models, decorations, DOM
      and computed styles.
- [ ] Assert:
  - [ ] +/− signs and copy-arrow margin; owning-side only; no duplicate revert icon.
  - [ ] line/word fills and placeholder exclusions.
  - [ ] native unchanged widget geometry/labels/Show all behavior.
  - [ ] semantic ruler marks and navigation targets.
  - [ ] font/line height/gutter/indent/density against `spec.json` tolerances.
- [ ] Fail explicitly when the editor/model/DOM is missing; no silent pass.
- [ ] Add negative controls (body layer removed, class removed, placeholder painted, duplicate
      revert, line-change ruler, model missing) and prove they fail.
- [ ] Dark+/Light+ full; HC smoke.

## Phase 3 — Preview/docs

- [ ] Capture `diff-body-reference` in `shotWebview` (Dark+/Light+ full, HC smoke).
- [ ] Write `artifacts/webview/diff-body-reference.audit.json`; fail on violations.
- [ ] Update `docs/WEBVIEW_PREVIEW.md` with the reference, caveat and negative controls.
- [ ] Ensure the capture cannot pass on a toolbar-only or empty body.

## Phase 4 — Verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] Focused reference/audit tests
- [ ] `npm test --ignore-scripts`
- [ ] `npm run shots:webview`
- [ ] `node esbuild.js --production`
- [ ] `git diff --check`

## Review gates

- [ ] Reference image/spec checked in and traceable to the shipped VS Code version.
- [ ] Audit reads the real ARXML body/models/computed styles.
- [ ] Every body affordance is checked; negative controls fail.
- [ ] Dark+/Light+ full and HC smoke pass.
- [ ] No false-green capture.
- [ ] Full suite/preview/production pass.

## Rollback

- [ ] Remove the reference files, state and audit; the body implementation remains.
