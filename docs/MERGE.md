# ARXML config merge

Merge three ECUC configurations — a **base** (their common ancestor), **ours** (the file
you are merging into) and **theirs** (the incoming changes) — into one new
`<name>.merged.arxml`. No source file is modified and nothing is written until every
conflict has a decision.

## Running it

1. Run **ARXML Scope: Merge ARXML Configurations** from the Command Palette.
2. Pick the base, ours and theirs files.
3. The diff panel opens in merge mode: the two panes compare **ours** and **theirs**, and
   a merge strip above them shows the conflict count, the current conflict and its values.
4. Use **Previous conflict** / **Next conflict** to walk the list, and **Keep ours** /
   **Take theirs** to decide each one. A conflict can be decided in any order.
5. **Write merge** is enabled once every conflict is resolved. It writes
   `<ours>.merged.arxml`, opens it, and leaves base, ours and theirs untouched.

The strip shows `base`, `ours` and `theirs` for the current conflict, plus the target
file name. A plain diff never shows the strip: merge mode exists only for a panel opened
by the merge command.

## What merges without asking

| Base → ours | Base → theirs | Result |
|---|---|---|
| unchanged | unchanged | ours |
| changed | unchanged | ours |
| unchanged | changed | theirs |
| changed | changed, same text | ours |
| deleted | unchanged | deleted |
| unchanged | deleted | deleted |
| added | — | ours |
| — | added | theirs |

## What is a conflict

- the same node changed differently on both sides;
- the same node added on both sides with different contents;
- one side deleted a node the other changed (delete vs modify);
- a container whose own fields changed on one side while the other side changed its
  children — the two cannot be combined without rewriting fields.

A conflict is always the smallest node that actually diverges: a container with two
conflicting children is two child conflicts, and a container whose children changed on
different sides merges both without a conflict.

## What is preserved

A kept element is copied from its own document with its bytes: tags, attributes,
conditions, annotations and relative formatting. The result is built from **ours'**
document, so unchanged lines are exactly ours' lines. A block taken from theirs is
re-indented by the difference between the two nesting levels; its internal formatting is
untouched.

Conflicts on a reference target or a condition are merged like any other field. The
merged file is validated when it opens, so a reference whose target no longer exists is
reported by the existing validation, not by the merge.

## Limits

- Pairing reuses the semantic diff. A container the diff pairs (for example a rename it
  can recognise) merges as one node; one it cannot pair is reported as a removal plus an
  addition, and an identical new name on both sides becomes an add/add conflict.
- A pure reordering is not a conflict: the merged document keeps ours' order, with
  theirs-only nodes inserted after their nearest matched sibling.
- Writing twice replaces only the merged file. There is no merge history and no
  auto-resolution policy.
- A real customer file is never needed for tests: the merge suite builds its scenarios
  from strings, and the synthetic benchmark covers the scale.
