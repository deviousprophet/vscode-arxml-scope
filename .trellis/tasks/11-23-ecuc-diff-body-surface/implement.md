# Implementation plan — VS Code-style diff body surface

## Branch gate

- [ ] Wait for PR #40 to merge to `main`.
- [ ] `git switch main && git pull`.
- [ ] Create `feat/ecuc-diff-body-surface` from latest `main`.
- [ ] Add `"overrides": { "dompurify": "^3.4.17" }` to `package.json`, refresh
      `package-lock.json`, and commit that setup on the new branch.
- [ ] `task.py start 11-23-ecuc-diff-body-surface` from that branch.
- [ ] Do not start from `feat/ecuc-vscode-parity`.

## Phase 0 — Baseline

- [ ] Capture the current `diff-body`/`diff-one-sided` body; record the missing +/−/copy-arrow/
      word/density states.
- [ ] Measure the VS Code `^1.125` / Monaco `0.57` reference gutter, line number, margin, line
      height, font, indentation and diff color roles.
- [ ] Map `DiffRow`/`DiffDisplayRow` → `leftLine`/`rightLine`/owning side/merge action.

## Phase 1 — Body contract and gutter

- [ ] Add the body row/line adapter from design §2; expose it for the other children.
- [ ] Add body/gutter/status classes on the diff host and both editors.
- [ ] Render semantic +/− signs on the owning side; no signs on missing-side placeholders.
- [ ] Restyle the existing copy arrows as the VS Code-style merge margin; keep the host click
      path and merge-mode visibility; no separate revert icon.
- [ ] Keep outside-merge mode to +/− signs only.

## Phase 2 — Line and word highlights

- [ ] Add a pure `wordDiffSpans(left, right)` helper and tests.
- [ ] Add semantic line-fill decorations using VS Code diff color roles; keep the readable
      fallbacks.
- [ ] Add changed-word spans on top of the line fill; no paint on placeholders.
- [ ] Keep selection/subtree tint and token colors correct.

## Phase 3 — Settings and density

- [ ] Wire `MonacoSettings` to both diff editors (font, line height, whitespace, guides, wrap if
      already supported, minimap off, decorations width).
- [ ] Align body CSS density/gutter/indentation with the reference metrics.
- [ ] Do not add an Ignore Whitespace toggle; the semantic diff continues to ignore formatting.

## Phase 4 — Preview/tests

- [ ] Add the fixed `diff-body` preview state with changed/added/removed/renamed and one-sided
      rows.
- [ ] Add unit tests for word spans, line mapping, owning-side signs/arrows and placeholder
      exclusions.
- [ ] Keep `diff-one-sided`, merge, selection, search, collapse and all existing audits green.
- [ ] Expose stable body classes/data for `11-23-ecuc-diff-visual-proof`.

## Phase 5 — Verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] Focused diff/body tests
- [ ] `npm test --ignore-scripts`
- [ ] `npm run shots:webview`
- [ ] `node esbuild.js --production`
- [ ] `git diff --check`
- [ ] Dark+/Light+ screenshots inspected; HC smoke.

## Review gates

- [ ] +/− signs and copy-arrow merge margin match the reference geometry/roles.
- [ ] No duplicate revert icon in merge mode; outside merge mode is +/− only.
- [ ] Line/word highlights use VS Code roles; placeholders unpainted.
- [ ] Font/line height/whitespace/guides/density match the reference within the semantic rows.
- [ ] Current ARXML toolbar and semantic behavior remain.
- [ ] Full suite/preview/production pass.

## Rollback

- [ ] Revert the body classes/decorations, word-span helper and settings wiring. No protocol or
      data migration.
