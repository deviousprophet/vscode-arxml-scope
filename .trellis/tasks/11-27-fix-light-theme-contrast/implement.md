# Implementation plan — fix light-theme toolbar contrast

## Phase 1 — Token

- [ ] Locate the toolbar label token and every label consumer (editor + diff).
- [ ] Choose the VS Code description/foreground token or mix; keep icons/meta separate.
- [ ] Add the HC fallback; no literal colour.
- [ ] Confirm the 4.5:1 target at 10–12 px in light and dark.

## Phase 2 — Proof

- [ ] `UX_HOST_ONLY='theme-zoom'` passes the light label contrast check.
- [ ] Preview `editor`/`diff-merge` audits and labels unchanged.
- [ ] `npm run check-types`, `npm run lint`, `npm test`.

## Rollback

Revert the child branch.
