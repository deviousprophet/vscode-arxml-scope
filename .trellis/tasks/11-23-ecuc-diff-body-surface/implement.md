# Implementation plan — modified built-in diff body

## Branch gate

- [x] Continue on `feat/ecuc-diff-body-surface` (user decision: finish all tasks on one branch).
- [x] Body-surface task reopened after the built-in-diff architecture review.
- [ ] `task.py start 11-23-ecuc-diff-body-surface` before implementation.
- [ ] Do not create a new branch.

## Phase 0 — Per-side builder

- [ ] Add `buildDiffSyntheticDocuments(document)` in `src/webview/monaco/synthetic.ts`.
- [ ] Emit each side's module gaps, comments, cells and braces independently; no blank placeholders.
- [ ] Keep per-side `rowLine`, line-key arrays and folding ranges.
- [ ] Add unit tests for line counts, row lines, comments, braces and one-sided gaps.
- [ ] Switch `diffMonaco.ts` from the aligned builder to the per-side builder.
- [ ] Update `DiffBody`/`diffBody.ts` and its tests for per-side lines.

## Phase 1 — Native body paint

- [x] Enable native diff indicators, line/word paint, diagonal fill and overview ruler.
- [x] Remove custom body fills, signs, word spans, ruler marks and placeholder decorations.
- [x] Remove the CSS that neutralizes Monaco's native line/char fills and the
      custom placeholder/sign/fill/selection styles; keep only syntax/theme.
- [x] Keep `arxml-diff-body`/gutter/status classes only as the audit contract.
- [x] Verify one-sided gaps show `.diagonal-fill` with no numbered placeholder line.

## Phase 2 — Built-in merge margin + one copy-left arrow

- [x] Keep `renderMarginRevertIcon` on and gate the built-in arrow with the merge class.
- [x] Capture the built-in `arrow-revert-change` click and post the host `copy`
      for the first semantic row in its deletion block.
- [x] Add exactly one `arrow-revert-change codicon codicon-arrow-left` in a
      zero-height view-zone `marginDomNode` per changed/added right-side row.
- [x] Rebuild the left arrows on document/swap/merge/diff changes; remove them
      outside Merge mode.
- [x] Do not add a custom overlay, pill, text arrow, glyph-margin arrow or model edit.

## Phase 3 — Preview / audit

- [x] Update `diff-one-sided` to assert per-side line counts, native diagonal fill,
      native fills/indicators and the copy-left arrow in the modified gutter.
- [x] Update `diff-body` to assert native body paint, the copy-left arrow and the
      host copy probe.
- [x] Add `diff-removed` to exercise a pure left-only block and the built-in right
      arrow click.
- [x] Remove the old placeholder/neutral-fill/blank-row/custom-margin audit fields.
- [x] Keep merge, search, collapse, navigation and Show all/diff states.

## Phase 4 — Verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] Focused builder/body/audit tests
- [ ] `npm test --ignore-scripts`
- [ ] `npm run shots:webview`; inspect `diff-body` and `diff-one-sided`
- [ ] `node .agents/skills/fallow-fix/scripts/fallow-extract.mjs` -> GREEN
- [ ] `node esbuild.js --production`
- [ ] `git diff --check`

## Review gates

- [ ] The body is a modified built-in diff, not a custom pre-aligned row renderer.
- [ ] Per-side line numbers and diagonal one-sided gaps are visible.
- [ ] Native line/word paint, indicators and overview ruler are visible; no duplicate custom paint.
- [ ] Monaco's built-in right arrow posts the host copy for a removed block.
- [ ] One copy-left arrow appears per right-side changed/added row in Merge mode.
- [ ] The current ARXML toolbar and semantic navigation remain.
- [ ] Full suite/preview/fallow/production pass.
- [ ] Stable DOM/classes are documented for the visual-proof child.

## Rollback

- [ ] Restore the aligned builder and custom body layer from the previous commit;
      no protocol or persisted-format migration.
