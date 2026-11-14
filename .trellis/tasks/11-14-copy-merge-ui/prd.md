# Two-way copy merge UI

Parent: `11-14-arxml-config-merge`. Depends on `11-14-diff-engine-port`: the patch path
and the engine diff must exist before this child starts (parent `implement.md` Step 2).

## Goal

Turn the diff panel into a Beyond Compare-style two-way merge: a merge toggle reveals a
copy arrow on each changed row in each pane; clicking or `Alt+←/→` copies that ECUC element
to the other document as one undoable edit, and the panel updates from the engine's patch
instead of rebuilding the diff.

## Requirements

- **R1 — Toggle.** A per-panel toolbar toggle, off by default, remembered while the panel
  lives. Off: the read-only diff. On: arrows, writes, and a `Merge` state in the toolbar.
- **R2 — Arrows.** One inline-SVG arrow per changed row per displayed pane, on the row's
  inner edge (outside the code text and the line-number gutter), visible on hover and
  keyboard focus. Unchanged rows show none. Clicking selects the row and copies.
- **R3 — Direction.** An arrow copies from the pane it belongs to into the other pane, in
  *displayed* coordinates, so Swap never changes where the bytes go.
- **R4 — Copy semantics.** Whole element: replace when both sides have the row; insert
  when only the source has it; delete (line span) when only the target has it. A container
  copy replaces the subtree, deleting target-only children; the tooltip says so.
- **R5 — Missing parents.** Copy the missing ancestor chain as minimal containers (own
  short name, definition ref and conditions, one child list with the copied chain) at the
  nearest matched sibling. Refuse when the chain needs a module.
- **R6 — Real documents.** One `WorkspaceEdit` per copy; the target becomes dirty;
  `Ctrl+Z` in the edited pane restores it; no merge state outside the documents.
- **R7 — Patch.** Apply the engine's diff-row patch; never a synchronous full rebuild. The
  four fallback cases (module change, duplicate-ordinal shift, unmatched/created parent,
  stale bytes) show a notice and schedule one debounced rebuild.
- **R8 — Stale.** On a range mismatch, a modal offers **Reload** (rebuild from the current
  in-editor documents) or **Cancel** (nothing changes). No copy is applied.
- **R9 — Keyboard.** `Alt+←` / `Alt+→` copy the focused row toward that side; no other key
  changes. Read-only mode ignores them.
- **R10 — Dirty marker.** The edited pane's label shows `•` ("unsaved changes") until the
  document is saved.
- **R11 — Module copies.** Allowed when the target has no module with that short name;
  refused for a name collision or a new package.
- **R12 — Performance.** 20 MiB pair: visible row change < 100 ms, comparison consistent
  < 250 ms via the patch, 10 copies / 10 s with at most one patch in flight.

## Acceptance criteria

- [ ] Toggle on/off; with it off, the existing read-only diff suites pass untouched.
- [ ] Copy left→right and right→left changes exactly the source element bytes in the target
      and one `Ctrl+Z` in that pane restores them.
- [ ] A container copy removes target-only children; a parameter copy changes one value.
- [ ] A copy into a missing parent creates the ancestor chain; a missing module is refused
      with no mutation.
- [ ] A placeholder arrow deletes the element on the other side, one undo step.
- [ ] Patch cases update the panel without a rebuild; each fallback case rebuilds and
      matches a fresh comparison.
- [ ] Stale modal: Cancel mutates nothing; Reload rebuilds from the buffers.
- [ ] `Alt+←` / `Alt+→` copy the focused row in both directions; read-only ignores them.
- [ ] The dirty marker appears and clears on save.
- [ ] The 20 MiB performance record meets R12.
- [ ] `docs/MERGE.md` describes the copy model; the changelog entry is updated; the
      editor-lifecycle spec documents the merge mode and the copy message.

## Out of scope

- Three-way merge, a base pane, conflicts, automatic resolution.
- Multi-row / range copy.
- Copying a module into a target that needs a new package.
- Undo other than VS Code's per-document history.

## Notes

- `design.md` / `implement.md` are written before `task.py start`; they inherit the parent
  `design.md` §2–§9 and only detail this child's files and tests.
- The copy message is `{ type: 'copy', side, key }`; the host validates merge mode, maps
  the displayed side, verifies bytes, applies one `WorkspaceEdit`, then posts the patch.
