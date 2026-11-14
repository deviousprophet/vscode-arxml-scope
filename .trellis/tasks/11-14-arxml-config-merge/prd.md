# Two-way copy merge in the diff view

## Goal

Merge two ECUC configurations *inside the diff panel*: a merge-mode toggle turns the
comparison into an editable two-way merge, each changed row gets an arrow on each side,
and clicking it copies that row — element, subtree and all — from the pane you clicked to
the other. The files are real documents, so the target becomes dirty and `Ctrl+Z` undoes
the copy. No base, no conflict model, no generated `.merged.arxml`.

## Context

The three-way design this task previously carried (base/ours/theirs, conflict strip,
blocking write, `doc.mergeIndex`) is **superseded**. Its planner, conflict model, command,
panel strip and docs are removed; only the text-composition pieces (element splice, line
deletion, re-indent) are reused. The decision record is in `design.md`.

The diff is read-only today, by documented design. Merge mode is a distinct state of the
same panel: off by default, arrows and writes exist only inside it.

## Requirements

- **R1 — Merge mode is a toggle.** A per-panel toolbar toggle, off by default; turning it
  on reveals the copy arrows and makes both panes writable; turning it off restores the
  read-only diff. A plain diff keeps its current guarantee and tests.
- **R2 — Copy both directions, per row.** One arrow per changed row per pane: the arrow on
  the left copies that row into the right document, the arrow on the right copies into the
  left. Unchanged rows show no arrow. The arrow sits on the row's inner edge, outside the
  code text and outside the line-number gutter, on hover and on keyboard focus.
- **R3 — Copy means "make this side match that side".** The unit is the whole ECUC element
  (module, container with its subtree, parameter, reference), copied byte-for-byte and
  re-indented to the target nesting. A container copy replaces the target element
  completely; target-only children are removed. When a row exists only on one side, the
  arrow on the empty side deletes that element from the other side.
- **R4 — Missing parents are created.** If the target lacks an ancestor container in the
  copied row's chain, that ancestor chain is copied verbatim from the source (same short
  names and definition refs) and inserted at its nearest matched sibling. A missing
  **module** is refused: the copy does not create a module or choose its package.
- **R5 — Real documents, native undo.** Each copy is exactly one `WorkspaceEdit` on the
  target `TextDocument`. The target is dirty afterwards, `Ctrl+Z` in the pane that was
  edited restores it, and no merge state lives outside the documents.
- **R6 — Stale snapshot asks before acting.** If the bytes at the range no longer match
  what the row showed, a modal offers **Reload** (rebuild the comparison from the current
  in-editor documents) or **Cancel** (change nothing). No copy is applied while stale.
- **R7 — Engine-computed diff and patch.** The Rust engine owns the diff (rows, keys,
  semantic matching, word diff) and answers a copy with the exact diff rows that changed;
  the panel applies a patch, never a full rebuild, and the patched result is observably
  identical to a full rebuild.
- **R8 — Explicit fallback.** Copies outside the patchable set (module change, a shift of
  duplicate ordinals, an unmatched or created parent, stale bytes) are refused with a
  reason and the panel performs a debounced full rebuild.
- **R9 — Keyboard and selection.** `Alt+←` / `Alt+→` copy the focused row toward that side;
  clicking an arrow selects the row and copies in one gesture. No other key changes.
- **R10 — Dirty indication.** The pane label of an edited side carries a `•` with
  "unsaved changes" until the document is saved.
- **R11 — Module copies.** A module row can be copied when the target has no module with
  the same short name; a name collision or the need for a new `AR-PACKAGE` is refused.
- **R12 — Performance.** On a 20 MiB pair: arrow click → row visibly changed under 100 ms,
  comparison consistent under 250 ms (the patch, not a rebuild), 10 copies in 10 s with at
  most one patch in flight. No copy blocks the UI thread on a full diff.

## Task map

| Task | Owns | Order |
|---|---|---|
| `11-14-diff-engine-port` | Rust diff (rows, keys, matching, word diff) at exact TS parity, streamed; the copy-patch endpoint | first |
| `11-14-copy-merge-ui` | merge-mode toggle, arrows, copy/insert/delete paths, reload modal, keyboard, dirty marker, patch application | after the port |

## Cross-task acceptance

- [ ] With the port landed, the panel renders a diff produced by the engine and the TS
      oracle agrees on every fixture.
- [ ] In merge mode, copying a row changes the target document by exactly the source
      element bytes, and `Ctrl+Z` in that pane restores it.
- [ ] Copying a container replaces the whole element, including deleting target-only
      children.
- [ ] A copy whose parent is missing creates the ancestor chain; a missing module is
      refused with a message and no mutation.
- [ ] The four fallback cases trigger a rebuild, never a wrong row.
- [ ] A stale snapshot shows the Reload/Cancel modal and applies nothing on Cancel.
- [ ] The read-only diff is unchanged with merge mode off (existing diff suites pass).
- [ ] `npm test`, `cargo test`, clippy, fmt, lint, parity and benchmarks pass.
- [ ] The three-way code is gone: no `doc.mergeIndex`, planner, conflict strip, merge
      command or `.merged.arxml` writer remains.

## Non-goals

- A three-way merge, a base pane, or automatic conflict resolution.
- Multi-row / range selection copies.
- Copying between more than two files, or syncing three panes.
- Editing non-ECUC ARXML, or creating modules/packages.

## Superseded decisions

The earlier answer set (three-way base/ours/theirs, conflict review, blocked write, new
`.merged.arxml`, semantic pairing of renames for merge) is replaced by this document. The
change is deliberate and recorded in `design.md` §1.
