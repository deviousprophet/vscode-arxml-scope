# Implementation plan — polish UX chrome and errors

## Phase 1 — Toolbar/sidebar

- [ ] Neutralize the sidebar toggle styling; keep the pressed state readable.
- [ ] Raise/adjust the diff toolbar label breakpoint; verify 1082 px.
- [ ] Define the diff default and Context state; add a change count or explain its absence.

## Phase 2 — Copy and find count

- [ ] Remove protocol/`npm` jargon from the activation failure; keep it persistent and actionable.
- [ ] Fix the diff find count to `1 of N` after the first match.
- [ ] Make the gate/diff stale copy truthful and offer the promised action.
- [ ] Name the missing module and add a reveal action.
- [ ] Record one index skip reason with its threshold.
- [ ] Fix `replace` reveal to leave one tab (or two distinguishable tabs).
- [ ] Add preview/host assertions for each finding.

## Phase 3 — Verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] Preview `toolbar-1400/1200/1024/900/800/640`, `diff-off`.
- [ ] Host `UX_HOST_ONLY=diff` and `UX_HOST_MODE=missing-engine`.

## Rollback

Revert the child branch; no migration.
