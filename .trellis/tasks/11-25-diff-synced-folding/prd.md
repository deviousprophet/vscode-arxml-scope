# Synchronize container folding across diff panes

## Goal

Collapsing or expanding a container or module on either side of the diff applies the same fold to the matching row on the other side.

## Requirements

- Detect user fold changes on both inner editors.
- Map folded ranges to semantic row keys, not raw line numbers.
- Apply the same collapse/expand state to the matching row key on the other side when that row exists.
- Nested and one-sided containers must not throw or toggle an unrelated row.
- Avoid feedback loops when the target editor reports its own hidden-area change.
- Keep Collapse All/Expand All working on both panes.
- After Swap or a new document, sync the current fold state once both models are installed.

## Acceptance criteria

- [ ] Collapsing `Items` on the left collapses `Items` on the right.
- [ ] Expanding from either side expands both.
- [ ] Nested container folds match by row key.
- [ ] A one-sided container folds only where it exists.
- [ ] A preview probe records the hidden row keys on both sides and fails on a mismatch.
- [ ] A pure test covers the key-mapping and toggle plan.
- [ ] No fold event loop or extra host messages.

## Non-goals

- Sharing one text model between panes.
- Replacing Monaco's folding controller.
- Persisting fold state across document reloads.
