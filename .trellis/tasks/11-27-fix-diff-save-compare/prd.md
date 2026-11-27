# Fix diff save and comparison truthfulness

## Goal

Close the two host-proven Major findings:

- **UX-06** — `Ctrl+S` inside the semantic diff does nothing; the receiving document stays dirty
  until the user opens its tab or uses Save All.
- **UX-07** — `Compare with First File` compares a deleted stashed file from cached text with no
  warning.

Source: `.trellis/tasks/11-27-ux-review-from-scratch/research/findings/UX-06-diff-save-noop.md`
and `UX-07-deleted-first-file-silent.md`.

## Requirements

1. While the diff panel has focus, `Ctrl+S` saves the receiving (dirty/copied) document through
   the extension's normal save path, not a second write path. If both sides are dirty, save the
   focused side and leave the other marker intact.
2. The page must not claim a save happened before the host acknowledges it; the dirty marker and
   copied-row mark clear only after the host save event.
3. `Save All` and the document tab save keep working.
4. Before opening a comparison from the first-file stash, verify the stashed URI still exists. If
   it is missing, show a warning naming the file, keep the stash, and open no panel.
5. Add regression tests: host/extension test for the diff save and the deleted stash; unit test
   for the existence check if it is pure.
6. Keep the protocol explicit: add the minimum save message/shape and update the protocol tests.

## Acceptance criteria

- [ ] Copy to Right → `Ctrl+S` while the diff pane has focus saves `right.arxml`; its tab and pane
      marker clear.
- [ ] Copy to Left works symmetrically.
- [ ] `Ctrl+S` on a clean diff does not write or show a false save.
- [ ] Deleted first file: `Compare with First File` warns, opens no panel, keeps the stash.
- [ ] Existing compare, copy, Save All and tab-save tests pass.
- [ ] Protocol tests cover the new save message and the absence of an invalid side.
- [ ] `npm run check-types`, `npm run lint`, `npm test`, `npm run engine:smoke`,
      `npm run rust:test` pass.
- [ ] Host `merge` and `stale-first` scenarios pass the new behavior.

## Non-goals

- Redesigning the diff toolbar or save UX.
- Changing how VS Code itself saves a focused text editor.
- Fixing stale-node or invalid-input feedback (child 2).
