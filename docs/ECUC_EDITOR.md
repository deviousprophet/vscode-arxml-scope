# ECUC Editor

The ECUC editor is a custom editor for AUTOSAR ECUC-Values `.arxml` files. It shows modules,
containers, parameters and references as a keyboard-navigable Document instead of raw XML, and writes
only the text of the field the user edited.

The editor is opt-in: a normal open still uses VS Code's text editor.

## Opening a file

Use any of:

- In the Explorer, right-click an `.arxml` file and choose **ARXML Scope → Open with ECUC Editor**.
- With an `.arxml` file active, right-click the editor and use the same **ARXML Scope** submenu.
- Run **ARXML Scope: Open with ECUC Editor** from the Command Palette.
- Use **Open With…** and pick **ECUC Values Editor**.

The file must have an `.arxml` extension and contain an `ECUC-MODULE-CONFIGURATION-VALUES` element.
Otherwise the extension explains why and hands the file back to the text editor. The custom editor's
manifest priority is `option`, so it never claims an `.arxml` file by default.

The page can be reloaded (for example after a webview crash) and asks the host for the current rows and
condition values again. It does not rely on the first HTML payload carrying model data.

## The Document surface

The left side is a single **Document** view; there is no Tree/Document toggle.

- Modules, containers, parameters and references are emitted in display order.
- A module label is the dotted definition path; a container shows its definition tail and short name;
  a parameter shows its name, `=`, value and quiet meta; a reference shows its name and target.
- Schema and package information appears in the header at the top of the scroller; it scrolls away with
  the rows rather than staying pinned.
- Annotations appear as muted italic comment lines directly above their node. Selecting a container
  tints the annotation rows of its descendants; the annotation rows stay non-selectable and clicking
  one changes nothing.
- Containers draw `{` and `}` brace rows. An empty container shows `{ }`.
- Collapsed containers show a ` { … }` hint and stay collapsible from the fixed 26px fold gutter.
- Bracket guides follow the open ancestor containers. They fade at rest and activate on hover.
- Selecting a container tints its visible subtree; syntax tokens keep their colours.
- Long labels, values and metadata stay on one line and scroll horizontally.

Only the visible window is rendered. Scrolling swaps two spacer heights and renders a small overscan
window, so a large file stays responsive. The scrollbars are native, and both axes work.

### Keyboard

| Key | Action |
|---|---|
| `Up` / `Down`, `Home` / `End`, `PageUp` / `PageDown` | Move the roving focus through the rendered rows. |
| `Left` | Collapse the focused container, or move to its parent. |
| `Right` | Expand the focused container, or move to its first child. |
| `Space` | Select the focused row. |
| `Enter` | A parameter opens its Details value editor; a container with children toggles; a leaf, empty container or reference reveals in source. |
| `Ctrl+Enter` / `Alt+Enter` | Reveal the focused row in source. |
| `F2` | Open a parameter's Details value editor. |
| A single character | Type-ahead jump to the next visible label with that prefix. |

### Search

Search runs on `Enter`; typing alone never scans.

- `Ctrl+F` / `Cmd+F` focuses the Search field.
- `Enter` runs a changed query and jumps to the first match; a second `Enter` moves to the next match.
- `Shift+Enter` moves backwards. `F3` / `Shift+F3` cycle while a committed query exists.
- `Escape` clears the query and returns focus to the Document.
- The count reads `1 / N`, or `0 / 0` when nothing matches. All matches are marked; the current row uses
  the stronger highlight.
- Search jumps and marks; it never hides rows. A jump expands the target's ancestors and selects the
  target but keeps focus in the Search field.

## Details panel

Select a row to populate the **Details** tab on the right. The panel reads the selected row from the row
store, so a selection that is scrolled out of the rendered window still shows correct data.

It shows the node kind, label, definition reference, short name, variant, AUTOSAR type, value or
reference target, contexts, conditions and annotations as applicable.

- Integer values show Decimal, Hexadecimal and Binary formats; Float shows Decimal only.
- References show **Jump to target** only when the target resolves to a row in the same file.
- **Reveal in source** opens the text editor at the node's range.
- The Details status line carries follow failures and a field refusal when the Details tab is hidden;
  field errors otherwise appear inline beside the control. There is no banner and no Source block or
  copy action.

The right edge also has a **Conditions** tab. Both tabs share the panel; only one is visible at a time.
The sidebar width, active tab, section sizes and collapsed sections persist across a webview reload.

## Editing rules

The Document surface is read-only. Editing happens in Details or through the row context menu.

### Field edits

- A parameter's `<VALUE>` is edited with a text input (or a `true`/`false` select for a Boolean
  parameter).
- A container's `<SHORT-NAME>` and `<DEFINITION-REF>` are edited with text inputs.
- `Enter` commits, `Escape` restores the committed value, and `Tab` moves to the adjacent parameter
  (value edit) or the container's other field.
- Integer and Float inputs reject characters that cannot belong to the value; the host still validates
  the complete value on commit.
- A refusal keeps the typed text, marks the control invalid and shows the reason beside the field. A
  refused value never reaches the file.
- A value backed by CDATA is shown but not editable.
- A module cannot be renamed: its short name is part of every container id.

Each accepted edit is exactly one `WorkspaceEdit` on the real text document, so it is one undo step.
The editor re-scans after every change; it never replays a stored offset.

### Structural edits

Right-click a **container** or **parameter** row for **Duplicate** and **Delete**. Other row kinds keep
the native context menu.

- **Delete** asks for confirmation and removes the whole element, including descendants.
- **Duplicate** inserts a copy after the original. A container copy asks for a unique short name first;
  a parameter copy keeps its `DEFINITION-REF` and value.
- Both actions re-scan and compare the recorded element bytes before writing, so a moved node is a
  refusal instead of a partial edit.
- One `Ctrl+Z` restores either action.

The editor does not create a brand-new container or parameter from scratch.

## Conditions panel

The **Conditions** tab edits the workspace values used to evaluate each node's own `SW-SYSCOND`.

- Values are stored per workspace in `workspaceState` under `arxmlScope.conditionValues.v1`; they are
  never written beside the ARXML.
- The panel lists constants referenced by the current document as document-owned rows: their values can
  be edited, but the rows cannot be removed. A manual row (a name the document does not reference) can
  be added, edited and removed.
- **Add** creates an unsaved draft; only **Save** commits and posts the entries. **Cancel** restores the
  committed value. **Clear values** empties the committed values but keeps the rows.
- The panel refuses an invalid name before it is saved. If a message still carries one, the host drops
  it, keeps the valid entries and reports the dropped names in the Conditions status.
- An empty committed value counts as **not set** and leaves the condition `unknown`.
- A false condition dims its row. On a container or module it disables the whole subtree; on a
  parameter or reference it disables only that row. An `unknown` condition never disables a row.
- Hover a condition chip to see one `NAME = value` line per referenced constant. `(not set)` means no
  value has been entered; strings are quoted.

## Reveal and navigation

| Action | Behaviour |
|---|---|
| **Reveal in source** (Details, `Ctrl+Enter`/`Alt+Enter` on a row; `Enter` on a leaf, empty container or reference) | Opens the ARXML text editor at the node's range. |
| **Jump to target** (Details, reference only) | Follows a same-file reference and selects the resolved row. |
| **ARXML Scope: Reveal in ARXML Source** | Command Palette entry for the same reveal path. |
| **ARXML Scope: Reveal in ECUC Editor** | From the active text editor, maps the cursor offset to the innermost ECUC node and opens/selects it in the ECUC editor. |

Reveal in source uses the panel's own column, so the source opens beside the ECUC editor rather than
beside whatever tab happens to be active. The `arxmlScope.ecuc.editor.revealMode` setting controls what
happens next.

Reference resolution is same-file only. There is no workspace index, so a target in another file is not
followable and gets no Jump action.

## Settings

| Setting | Values | Default | Effect |
|---|---|---|---|
| `arxmlScope.ecuc.editor.sort` | `all` / `declaration` | `all` | `all` sorts modules, containers, parameters and references by the display rules; `declaration` keeps the file's own order. |
| `arxmlScope.ecuc.editor.sortExcept` | array of `DEFINITION-REF` tails | the 15-entry legacy list | Rows whose definition tail matches keep declaration order even under `sort: all`. |
| `arxmlScope.ecuc.editor.revealMode` | `beside` / `focus` / `replace` | `beside` | `beside` opens the source next to the editor and keeps focus in the tree; `focus` also moves focus to the source; `replace` swaps the ECUC editor's tab for the text editor. |

An open panel re-renders when `arxmlScope.ecuc.editor` changes; you do not need to reopen the file.

## Limitations

- Only AUTOSAR ECUC-Values files are supported. Other `.arxml` files are shown in the text editor.
- Reference resolution, type display and validation are same-file and syntax-shaped. There is no AUTOSAR
  schema validation, no cross-file definition index and no language-server completion.
- The Document is read-only by design; edits are limited to `<VALUE>`, container `<SHORT-NAME>` /
  `<DEFINITION-REF>`, and delete/duplicate of a container or parameter.
- CDATA-backed values are displayed but cannot be edited.
- Conditions are evaluated for display only; the extension does not rewrite or remove disabled nodes.
- The page follows the editor theme for colours and fonts. Search uses fixed highlight tiers because
  theme find-match colours may be transparent; high contrast/forced-colours uses outlines instead of
  fills.
- Large files are virtualized, but browser layout/paint cost is not eliminated. Use the benchmark suite
  for scan/row/diff timing, not as a promise for every machine.
