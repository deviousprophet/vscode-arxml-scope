# Semantic ARXML diff view

## Goal

Let a user compare two `ECUC-MODULE-CONFIGURATION-VALUES` ARXML files by ECUC identity and see
exactly which modules, containers, parameters and references were added, removed or changed — in a
read-only, two-pane webview that stays in sync with unsaved edits.

This is a **semantic** diff: two files that differ only in declaration order, formatting or
comments must compare equal. It is not a text/line diff.

## Confirmed facts

- `scanEcucValues` produces a model with modules, containers, parameters, references and source
  ranges (`src/core/ecuc/model.ts`).
- `buildRows(model, options)` produces display-ready `EcucRow` values with a path-based `id`,
  parent id, subtree size, label, shown value, meta parts and haystack
  (`src/editor/renderRows.ts`). The editor page already renders these rows with
  `valueSpan` / `metaSpan` / `appendHighlighted`.
- `buildNodeIndex` ids are stable across re-scans and include a declaration ordinal for duplicate
  sibling names (`src/editor/nodeId.ts`). They are a valid cross-file identity key.
- `revealRangeInTextEditor` opens a text editor beside a column without destroying the caller's
  tab (`src/editor/navigation.ts:143`).
- The sibling extension `vscode-hex-scope` ships a compare flow with a submenu, a session-only
  first-file stash, a shared-row aligned panel, a `ready` handshake and debounced external refresh.
  Its patterns are recorded in `research/hex-scope-diff-reference.md`.
- There is no runtime dependency and no diff code in this repository.

## Requirements

### Entry points

- **R1** Three commands:
  - `vscode-arxml-scope.selectAsFirst` — stash the clicked ARXML file as the left side and show a
    confirmation message.
  - `vscode-arxml-scope.compareToStaged` — compare the stashed left file with the clicked right
    file; only meaningful when a stash exists.
  - `vscode-arxml-scope.compareSelected` — from an Explorer two-file selection, compare the
    clicked file (left) with the other selected file (right). With no selection, open a two-file
    dialog as a palette fallback.
- **R2** The three commands are contributed to the `ARXML Scope` submenu in `explorer/context` with
  the reference's visibility rules (single file, Explorer focus, `listDoubleSelection`,
  `arxmlScope.hasCompareSelection`). They also remain available from the command palette.
- **R3** Both files are validated with `gateReason` before the panel opens. A non-`.arxml` or
  non-ECUC file is refused with a warning and no panel.

### Comparison semantics

- **R4** Modules are matched by `DEFINITION-REF` + `SHORT-NAME`; containers by their ancestor
  short-name path + `SHORT-NAME`; parameters/references by container path + definition-ref tail
  (`name`) + duplicate ordinal. The `EcucRow.id` is the primary key.
- **R5** If same-named siblings were reordered, ids differ only by their ordinal. Match the
  remaining exact-key leftovers by an ordinal-stripped base key when exactly one candidate remains
  on each side.
- **R6** A matched row is `changed` when any compared field differs:
  `label`, `shortName`, `definitionRef`, `definitionDest`, `value`, `target`, `shownValue`,
  `contextPaths`, variant meta, or condition meta. Annotation meta is **not** compared.
  An added/removed row is a row present on only one side; its descendants are also added/removed.
- **R7** Display order is deterministic and independent of the user's sort setting: both sides
  use `sort: 'all'` with the default `SORT_EXCEPTIONS`. Unchanged declaration-order differences
  therefore produce no diff. A node moved to a different parent is removed + added, because its
  ECUC path changed.
- **R8** A paired row is aligned on one output row. A removed row occupies the left cell; an added
  row occupies the right cell; the other cell is an empty placeholder.
- **R9** Right-only children are inserted after the nearest preceding right sibling that matched a
  left row; when none exists they are inserted before the first left child. Left rows keep their
  order.

### Panel

- **R10** A read-only `WebviewPanel` titled `<left> ↔ <right>`; same-named files are disambiguated
  by the shortest distinguishing path suffix.
- **R11** Two fixed panes with sticky file headers and one shared vertical scroll. Each row shows
  the node label, `= value` (parameters/references), and the existing meta chips. Changed rows mark
  both sides; added rows mark the right side; removed rows mark the left side.
- **R12** Toolbar: a text filter, a "Changes only" toggle, summary counts (`n changed`,
  `n added`, `n removed`), previous/next change buttons, expand all / collapse all, and a
  "No differences" empty state. The filter input is `type="text"` so it has no native clear X.
- **R13** Changes-only hides unchanged rows but keeps the ancestors of a visible change.
  Collapse state is preserved across filter changes; an active filter force-expands ancestors with
  visible descendants, exactly like the editor.
- **R14** Previous/next change cycles through visible `changed` / `added` / `removed` rows, wraps,
  scrolls the row into view and selects it. `F7` / `Shift+F7` do the same while the list has focus.
- **R15** Selecting a row highlights both cells and shows a detail strip with the changed fields
  and their left/right values. The strip has "Open left in source" and/or "Open right in source"
  buttons that reveal the node's range in the text editor beside the panel. Reveal never replaces
  the diff tab, even when `arxmlScope.ecuc.editor.revealMode` is `replace`.
- **R16** The list is keyboard reachable: `role="tree"`, `treeitem` rows with `aria-level`,
  `aria-expanded`, `aria-selected`, and a visually hidden status word. Up/Down moves selection,
  Left/Right collapses/expands, Enter reveals the selected row's left side (or right when only the
  right exists).
- **R17** Rows are virtualised: only the viewport plus overscan is in the DOM, with top/bottom
  spacers driven by `calcVisibleRange` / `calcTotalHeight`.

### Lifecycle

- **R18** Both files are read through `workspace.openTextDocument`, so unsaved buffers are
  compared. `onDidChangeTextDocument` for either URI re-scans and re-diffs after a short debounce;
  the page keeps its filter, changes-only toggle, collapse set, selection and scroll position.
- **R19** The panel is read-only: no `WorkspaceEdit`, no `writeFile`, no repair path. Closing it
  disposes every listener and timer.
- **R20** If a document stops being ECUC while the panel is open, the last good diff stays visible
  with an error banner; the panel does not crash or silently show stale ranges as current.

## Acceptance criteria

- [ ] **AC1** With `left.arxml` and `right.arxml` open, `Compare with the 1st File` opens a
  `vscode-arxml-scope.diff` webview panel with both file names in the title.
- [ ] **AC2** Comparing a file with itself reports `0 changed / 0 added / 0 removed` and shows
  "No differences".
- [ ] **AC3** A changed parameter value produces exactly one `changed` row with both values and a
  summary of `1 changed`.
- [ ] **AC4** An added container produces added rows for the container and every descendant; a
  removed container does the same on the left.
- [ ] **AC5** Reordering modules, containers, parameters or references in the XML produces no
  changes. Reordering two same-named sibling parameters also produces no changes (R5 fallback).
- [ ] **AC6** Moving a container under a different parent produces one removal subtree and one
  addition subtree.
- [ ] **AC7** Changes-only hides unchanged rows but keeps the parent chain of every visible change;
  clearing it restores the previous collapse state.
- [ ] **AC8** Next/previous change and `F7`/`Shift+F7` visit every changed row, wrap at the ends,
  and select the row they scroll to.
- [ ] **AC9** "Open left in source" reveals the left node's exact range beside the panel and the
  diff tab remains open, including with `revealMode: "replace"`.
- [ ] **AC10** Editing either open document and saving updates the panel within one debounce, with
  filter/collapse/selection preserved; no file is written by the panel.
- [ ] **AC11** Comparing a non-ECUC `.arxml`, a non-`.arxml` file, or the same file twice is refused
  with a warning (same file twice may show "No differences" if both sides are valid).
- [ ] **AC12** A large fixture (more than 200 rows) renders only a window of rows; scrolling reaches
  the last row and the spacers total the full list height.
- [ ] **AC13** The manifest contributes the three compare commands and attaches them to the
  `ARXML Scope` submenu; no flat diff command is added to `editor/context`.
- [ ] **AC14** The diff page passes the production boot gate in `npm run package`.
- [ ] **AC15** All new pure logic (matching, status, ordering, visibility, title) is unit-tested,
  and the integration test opens the panel through a command.

## Out of scope

- Text/byte diff, three-way merge, conflict markers, Git/SCM integration.
- Writing, repairing or merging any ARXML.
- Comparing more than two files.
- Comparing across workspaces or unopened files other than via the file dialog.
- Persisting the compare selection or panel state across window reloads.
- Showing diff status in the ECUC editor's own tree.
- A unified single-tree diff mode (two-pane aligned rows only).
