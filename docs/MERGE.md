# Two-way copy merge in the diff

The diff panel can merge two ECUC configurations directly: turn on **Merge** and copy a
row from either side into the other. It is the compare view plus arrows — no base file, no
conflict wizard, no generated `.merged.arxml`.

## Using it

1. Compare two files as usual (**Compare with…** or **Compare Selected**).
2. Click **Merge** in the diff title strip. The toggle only affects this panel and is off
   by default.
3. Changed rows show an arrow on their inner edge: `→` on the left pane copies that row
   into the right file, `←` on the right pane copies into the left. A row with an element
   only on one side keeps an arrow on the empty side; that arrow deletes the element from
   the side that has it.
4. `Alt+←` / `Alt+→` copy the focused row toward that pane.
5. Save the file you changed with the normal **Save**. `Ctrl+Z` in that pane undoes one
   copy; the pane label shows `•` while its document is dirty.

Turning **Merge** off restores the read-only diff: no arrows, no writes, identical to
before.

## What a copy does

| Source | Target | Result |
|---|---|---|
| element present | element present | the target element is replaced by the source element |
| element present | absent | the source element is inserted under the matched parent |
| element absent | present | the element is deleted from the side that has it |

The unit is the **whole ECUC element**: a container carries its subtree, so replacing a
container also removes children only the target had. Every copy is one undo step.

When the target lacks a parent container, the missing ancestors are created as **minimal
containers** — their own short name, definition ref and one child list holding only the
copied chain. Unrelated children of the source ancestors are not imported. If the missing
chain would need a **module**, the copy is refused: creating a module also decides its
`AR-PACKAGE` and definition.

## Safety

- The comparison is built from a snapshot. If either document changed before the copy is
  applied, a modal offers **Reload** (rebuild from the in-editor documents, keeping
  unsaved copies) or **Cancel** (nothing changes).
- A copy that cannot be placed (no sibling, missing module) is refused with a message and
  writes nothing.
- Merge mode is the only write path in the diff; the panel refuses copies while it is off.

## Limits

- One row per copy; multi-row/range copies are not implemented.
- Creating modules or packages is out of scope; copy an existing module row instead where
  the target has no name collision.
- References whose targets move are not repaired by the merge; the existing validation
  reports them after the files are saved.
- Reordering is not a copy: arrows act on the row they are clicked on.
