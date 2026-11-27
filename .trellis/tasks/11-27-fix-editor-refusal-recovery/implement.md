# Implementation plan — fix editor refusal and recovery feedback

## Phase 1 — Invalid/refused feedback

- [ ] Unify the refusal state and render it once at the strongest surface.
- [ ] Make Decimal/Hex/Binary follow the draft or label the last accepted value.
- [ ] Mark the refused field (short name / value) consistently.
- [ ] Update the two preview audits and host refusal evidence.

## Phase 2 — Stale-node recovery

- [ ] Add a page stale state: row marker, disabled Details controls, persistent banner.
- [ ] Add **Discard draft** and **Reload** actions; clear dirty only when no drafts remain.
- [ ] Ensure `Ctrl+S` does not loop on the dead node.
- [ ] Add preview assertions and confirm in host `stale-node`.

## Phase 3 — Verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run engine:smoke`
- [ ] `npm run rust:test`
- [ ] Preview `editor-invalid`, `editor-rename-refusal`, `editor-stale-save` with audits.
- [ ] Host `UX_HOST_ONLY=stale-node`.

## Rollback

Revert the child branch; no migration.
