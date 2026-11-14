# Design — two-way copy merge UI

Inherits the parent `design.md` §2–§9. This child adds the host copy path, the panel
state and the page affordance; the engine patch arrives with the port.

## 1. Host copy path

`DiffPanel` gains a per-panel `mergeMode` boolean and handles one message:

```text
page → host: { type: 'copy', side: 'left'|'right', key }
```

`side` is the host side the page computed from its displayed pane (`hostSide`). The host:

1. refuses when merge mode is off or the row no longer exists;
2. reads the row's `left`/`right` cells; the clicked side is `source`, the other `target`;
3. opens both documents and takes their text;
4. builds a `CopyRequest` for `core/copy/planCopy`:
   - both cells → replace (source range, target range, expected target bytes);
   - source only → insert after the nearest preceding sibling with a target cell, else
     before the first following one; the parent is the row's `parentKey` cell;
   - target only → delete the target element;
   - `targetIndent` from the target sibling/parent line;
5. applies the returned span as one `WorkspaceEdit` on the target document;
6. shows the refusal text on `stale`/`no anchor`, nothing else.

Missing ancestors and module copy rules are parent `design.md` §4/§11; the planner here
covers the same-parent cases first. Ancestor synthesis lands as its own step (M4).

## 2. Panel state

- `mergeMode` starts false; a toolbar toggle flips it and posts `{ type: 'mergeMode' }` to
  the page (the page hides arrows and ignores keys when false).
- Toggling off does not undo anything; it only removes the affordance.
- The panel keeps the mode across a document refresh (it is host state, not page state).

## 3. Page affordance

- A merge button in the diff title strip (no new toolbar group; the shell stays static).
- When on, `fillContentRow` appends one arrow button to the row's inner edge when the row
  has a cell on that pane's side and `status !== 'unchanged'`. The button posts `copy` and
  selects the row.
- `Alt+←`/`Alt+→` on a focused row posts the same message.
- The edited pane's title gets `•` while its document is dirty.

## 4. Update path

Until the port lands, a copy applies the `WorkspaceEdit`; the document change triggers the
existing debounced refresh. The page also patches the copied row optimistically from the
new text so the click is visible immediately. The engine patch replaces the debounced
rebuild in the port follow-up; this child's acceptance only requires the visible change and
a consistent comparison.

## 5. Tests

- Core: `planCopy` (landed).
- Extension: copy replace/delete/insert against fixtures, one undo, stale refusal, mode
  off refusal.
- Page: arrow visibility per status/mode, message shape, keyboard, dirty marker.
