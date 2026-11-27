# Fix editor refusal and recovery feedback

## Goal

Close the two Major editor findings:

- **UX-01** — one invalid/refused value is reported in four places with disagreeing red/amber
  treatments, while Decimal/Hex/Binary keep showing the last accepted value.
- **UX-02** — a stale-node save is a dead end: the row stays selected and Details stays editable
  for a node that no longer exists; the only notice is a distant amber line, with no recovery
  action.

Source: `.trellis/tasks/11-27-ux-review-from-scratch/research/findings/UX-01-…` and
`UX-02-…`.

## Requirements

1. One primary failure surface per refusal, chosen by context (top strip when Details is hidden,
   inline at the field/row when visible). Do not show the same refusal in four places with
   different colours.
2. A refused invalid value marks the field and keeps the draft; the derived Decimal/Hex/Binary
   rows either follow the draft or explicitly say "last accepted value".
3. A stale-node save keeps the draft, marks the row, disables editing for that dead node and
   offers a recovery action: **Discard draft** (restore the host value) and/or **Reload** the
   document. The user must not be stuck with an editable phantom.
4. Preserve the existing local-first draft/undo/save behavior for valid nodes.
5. Add regression coverage at the page/preview layer and the host `stale-node` scenario.
6. Update the editor user docs only if behavior/copy changes; no preview docs under `docs/`.

## Acceptance criteria

- [ ] `editor-invalid` shows one consistent error treatment and no stale derived values.
- [ ] `editor-rename-refusal` marks the short-name field and uses operation-specific copy.
- [ ] `editor-stale-save` marks the row, blocks editing the dead node, and offers a recovery
      action; `Ctrl+Z`/discard restores a clean state.
- [ ] Host `stale-node` confirms the same behavior with a real theme.
- [ ] Valid edit/save/undo/redo and multi-row save still pass.
- [ ] `npm run check-types`, `npm run lint`, `npm test`, `npm run engine:smoke`,
      `npm run rust:test` pass.

## Non-goals

- Reworking the editor draft model.
- Fixing diff save or deleted first file (child 1).
- Toolbar/sidebar/activation polish (child 3).
