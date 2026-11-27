# Design — fix UX review findings

## Structure

The parent is an integration task, not an implementation target. Each child owns its branch,
implementation, tests and review gate. The parent verifies the combined behavior and checks that
the fixes match the review evidence.

## Source of truth

- Report: `.trellis/tasks/11-27-ux-review-from-scratch/research/UX_REVIEW.md`
- Findings: `.../research/findings/UX-01…UX-09`
- Host repro: `.../research/host-runs.md`
- Evidence: `.../research/evidence.md` and `.../evidence/`

Do not rewrite the review's evidence to match a fix. If a finding is refuted during
implementation, record why in the child's check notes and update the review report's disposition
only after the parent review.

## Branching

Each child branches from `feat/ux-review-from-scratch` so it inherits the consolidated `ux-review`
skill and the review evidence. Merge order is child 1 → child 2 → child 3; the parent branch is
the integration branch if a combined review is needed.

## Fix ownership

| Concern | Owner |
|---|---|
| Diff save command/keybinding | `src/webview/diffMonaco.ts`, `src/host/diffPanel.ts`, diff protocol/tests |
| Deleted first-file guard | `src/host/compareSelection.ts` / `diffPanel` open path, host test |
| Invalid/refused feedback and derived formats | `src/webview/editorMonaco.ts`, Details/status rendering, preview audit |
| Stale-node recovery | `src/webview/editorMonaco.ts` + `src/host/ecucEditorProvider.ts` save/refusal path, host test |
| Toolbar/sidebar/Context/find/activation copy | webview toolbar/CSS, diff find bridge, `engineLoader`/activation error |

## Integration review

- Compare every child diff to its finding's expected behavior.
- Re-run the exact repro from the finding.
- Check the primary journeys still pass: editor edit/save, diff open, merge copy/save, missing
  engine, first-file stash.
- Confirm no new `docs/` preview page and no skill duplicate.
- Record any deferred finding as a limitation, not silently.

## Rollback

Each child is a separate branch; revert a child without touching the others. The parent can drop
a child from the integration order if it cannot pass.
