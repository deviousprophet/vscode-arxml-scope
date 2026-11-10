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
- Schema and package information is the first content in the document. These lines scroll with the
  rows, use the same row shell and are searchable and focusable, but they are not ECUC nodes: clicking
  one never changes the selection or Details. One blank line separates the header from the first
  module. The editor has no file-name strip.
- One blank numbered line separates consecutive module groups. It sits above the module's annotations,
  has no rule, border, hover or selection treatment, and clicking it or its number changes nothing. The
  first module has no module gap.
- A fixed line-number gutter numbers each display line from 1: the schema/package lines, the blank
  separator, the module gaps, annotations, braces and nodes. Numbers renumber when containers collapse
  or the document changes, and the selected row's number uses the active line-number colour. The
  selected and keyboard-focused rows also repeat their 2px rail on the number cell, so the indicator
  stays visible beside the opaque gutter. The gutter stays fixed
  while the document scrolls horizontally, follows the rows vertically, and is not searchable,
  selectable or focusable. Clicking a number performs the row's own action: it selects a node, focuses a
  header, and does nothing for a blank separator or module gap.
- Annotations appear as muted italic comment lines directly above their node. Selecting a container
  tints the annotation rows of its descendants; the annotation rows stay non-selectable and clicking
  one changes nothing.
- Containers draw `{` and `}` brace rows. An empty container shows `{ }`.
- Collapsed containers show a ` { … }` hint and stay collapsible from the fixed 26px fold gutter.
- Bracket guides follow the open ancestor containers. They fade at rest and activate on hover.
- Selecting a container tints its visible subtree; syntax tokens keep their colours.
- The selected row background, its 2px rail and the selected-subtree tint span a stable width: at least
  the visible pane and the full document content width. A longer row scrolling into or out of the
  rendered window does not change that width, and the highlight starts after the fixed gutter and
  reaches the pane's right edge.
- Long labels, values and metadata stay on one line and scroll horizontally.

Only the visible window is rendered. The page precomputes the row offsets, including the header rows,
the header gap and the module gaps, so the scrollbar thumb and drag match the content; a scroll frame
only renders the visible window. One virtual-scroll surface owns the vertical scroll and the row
offsets; the docs view has one horizontal bar, and the scrollbars are native.

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
- The schema/package keyword (`schema`, `package`) and its value are search candidates: both are
  marked, and the current header uses the stronger tier. A header jump focuses the header line and posts
  no `select` message, so the ECUC selection and Details stay unchanged.
- Search jumps and marks; it never hides rows. A jump expands the target's ancestors and selects the
  target but keeps focus in the Search field.

## Details panel

Select a row to populate the **Details** tab on the right. The panel reads the selected row from the row
store, so a selection that is scrolled out of the rendered window still shows correct data.

It shows the node kind, label, definition reference, short name, variant, AUTOSAR type, value or
reference target, contexts, conditions and annotations as applicable.

- Integer values show Decimal, Hexadecimal and Binary formats; Float shows Decimal only.
- When the workspace index resolves the row's `DEFINITION-REF`, Details adds **Definition type**,
  **Range**, **Default**, **Multiplicity**, **Values** (enumeration literals), **Destination**,
  **Definition description** and **Definition file**. Only declared fields appear.
- References show **Jump to target** only when the target resolves to a row in the same file.
- **Reveal in source** opens the text editor at the node's range.
- The Details status line carries follow failures and a field refusal when the Details tab is hidden;
  field errors otherwise appear inline beside the control. There is no banner and no Source block or
  copy action.

## Workspace index and definitions

The extension keeps an in-memory index of every `.arxml` file in the workspace. It is built on
activation, follows file creation, saves and deletion, and is thrown away when the window closes.
Nothing is written beside your files.

- The status bar shows **ARXML Scope: N files indexed** and the cross-file check mode. Hover it for
  element, reference, definition and package counts; click it to cycle `auto` / `always` / `never`, or
  run **ARXML Scope: Rebuild Workspace Index** to rebuild.
- **Details** resolves a container or parameter `DEFINITION-REF` against `ECUC-MODULE-DEF` and
  `ECUC-PARAM-CONF-CONTAINER-DEF` elements in any indexed file. A unique suffix resolves; copies of one
  identity resolve to the copy in the referencing file, or to every copy for navigation. A definition
  path shared by several bodies shows `N definitions found` instead of silently picking one.
- `arxmlScope.index.enabled` turns the index off; `arxmlScope.index.maxFileSizeMB` (default 50) skips
  files that are too large to read comfortably, and `arxmlScope.index.exclude` drops generated or
  duplicate trees before discovery. Skipped and excluded files are reported in the status bar tooltip.
- Indexed files may be UTF-8 (with or without a BOM), UTF-16LE/BE with a BOM, or declare UTF-8,
  ISO-8859-1, windows-1252 or US-ASCII. An unsupported encoding is skipped and reported instead of
  being decoded as incorrect text.
- A save updates only that file's index contribution. A full rebuild still replaces the whole index.

## Validation

Validation runs after each index change and publishes to the Problems panel and the text editor. It is
debounced, runs in short slices so the editor stays responsive, and the status bar shows
**ARXML Scope: validating…** while a pass is active. A newer index change cancels the running pass and
starts a fresh one.

- Broken references are reported only for `DEST`s the index models with a path
  (`ECUC-MODULE-CONFIGURATION-VALUES`, `ECUC-CONTAINER-VALUE`); parameter-value and non-ECUC `DEST`s
  are not judged.
- A duplicate AR path produces one diagnostic with related locations. Cross-file duplicates are
  `information` by default; same-file duplicates use the configured severity.
- Multiplicity counts within one file and one owning parent, never across generated copies.
- `ECUC-ADD-INFO-PARAM-DEF` children and required children with a `DEFAULT-VALUE` are not missing.
- An empty `<VALUE>` means “use the default”; Boolean `0`/`1` and float `INF`/`-INF`/`NaN` are valid.
- Missing definitions are grouped at the highest missing ancestor (or the missing module definition)
  with an instance count.
- `arxmlScope.validation.maxDiagnosticsPerFile` (500) and `maxDiagnostics` (5000) cap the panel; one
  summary diagnostic per file states how many problems were hidden. `0` disables a cap.

## Plain text editor

The same index backs the normal text editor, without opening the custom editor:

- **Outline / breadcrumbs** list modules, containers, parameters and references; definition files
  list their module, container, parameter and reference definitions.
- **Go to Definition** on a `DEFINITION-REF` opens the definition; on a `VALUE-REF` / `TARGET-REF` it
  opens the target element, across files.
- **Find References** on a container/module short name or a definition lists every instance and
  reference that resolves to it.
- **Document links** make every resolving `*-REF` path clickable.
- **Hover** shows the target path and kind, or the definition type, range, multiplicity and
  description.
- Diagnostics from the validation rules appear in the Problems panel and as text-editor markers.
- Outline, links and hover read files up to `arxmlScope.index.maxFileSizeMB`; a larger file still opens
  normally, but these text features stay off for it.

The text editor uses the document's current text, so unsaved edits participate. The custom editor's
**Find references** button lists the same reverse references in a Quick Pick.

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
| **Jump to target** (Details, reference only) | Follows a reference across files; a same-file target selects the row, an ECUC-Values target opens that file at its row, and any other ARXML target opens the text editor at its range. |
| **Find references** (Details, module/container) | Lists every indexed reference that resolves to the selected element; choosing one reveals it in the text editor. |
| **ARXML Scope: Reveal in ARXML Source** | Command Palette entry for the same reveal path. |
| **ARXML Scope: Reveal in ECUC Editor** | From the active text editor, maps the cursor offset to the innermost ECUC node and opens/selects it in the ECUC editor. |

Reveal in source uses the panel's own column, so the source opens beside the ECUC editor rather than
beside whatever tab happens to be active. The `arxmlScope.ecuc.editor.revealMode` setting controls what
happens next.

Reference resolution for **Jump to target** uses the workspace index: an absent or ambiguous target is
reported instead of guessed. A target in a non-ECUC ARXML file opens the text editor. Definition
lookup is also cross-file and updates an open panel when a definition file changes.

## Settings

| Setting | Values | Default | Effect |
|---|---|---|---|
| `arxmlScope.ecuc.editor.sort` | `all` / `declaration` | `all` | `all` sorts modules, containers, parameters and references by the display rules; `declaration` keeps the file's own order. |
| `arxmlScope.ecuc.editor.sortExcept` | array of `DEFINITION-REF` tails | the 15-entry legacy list | Rows whose definition tail matches keep declaration order even under `sort: all`. |
| `arxmlScope.ecuc.editor.revealMode` | `beside` / `focus` / `replace` | `beside` | `beside` opens the source next to the editor and keeps focus in the tree; `focus` also moves focus to the source; `replace` swaps the ECUC editor's tab for the text editor. |
| `arxmlScope.index.enabled` | boolean | `true` | Build the in-memory workspace index used for definition details and the status bar. |
| `arxmlScope.index.maxFileSizeMB` | number ≥ 1 | `50` | Largest `.arxml` file the index reads. Larger files are skipped and counted in the tooltip. |
| `arxmlScope.index.exclude` | array of workspace-relative globs | `[]` | Files never indexed, validated or used by navigation or text-editor features. Example: `**/_fwd/**`, `**/_out/**`, `**/_gen/**`. |
| `arxmlScope.validation.enabled` | boolean | `true` | Publish ECUC validation diagnostics to the Problems panel and the text editor. |
| `arxmlScope.validation.severities` | per-rule `error` / `warning` / `information` / `off` | see defaults | Choose the severity of each rule, or turn one off. |
| `arxmlScope.validation.maxDiagnosticsPerFile` | number ≥ 0 | `500` | Maximum diagnostics per file; `0` is unlimited. A summary reports hidden problems. |
| `arxmlScope.validation.maxDiagnostics` | number ≥ 0 | `5000` | Maximum diagnostics for the workspace; `0` is unlimited. |
| `arxmlScope.validation.crossFileRules` | `auto` / `always` / `never` | `auto` | `auto` runs cross-file checks only when the index contains an ECUC definition; `always` reproduces the unconditional behaviour; `never` disables them. The status bar cycles this setting. |
| `arxmlScope.diff.semanticMatching` | boolean | `true` | Pair renamed modules and containers as one changed row. The diff toolbar toggle changes only the current panel. |

An open panel re-renders when `arxmlScope.ecuc.editor` changes; you do not need to reopen the file. A
definition saved anywhere in the workspace re-renders the open panel as well, and the diagnostic
collection is recomputed after every index change.

## Limitations

- Only AUTOSAR ECUC-Values files are supported by the editor. Other `.arxml` files stay in the text
  editor, but they still contribute packages, elements and definitions to the workspace index and get
  definition symbols, links, hover and references.
- The index is in memory only and is rebuilt on activation. There is no persisted cache.
- Validation checks ECUC-Values instances against indexed definitions. A definition file is used as
  data; its own schema is not validated.
- Definition resolution refuses an ambiguous suffix. Vendor-specific variant merging is not performed;
  copies of one identity resolve to the referencing file's copy or to every copy for navigation. When
  several definition bodies share one path, Details shows `N definitions found` and does not pick one.
- Validation is a full workspace pass after the debounce; the benchmark bounds it, but a very large
  workspace can still take a moment before the Problems panel updates. The diagnostic caps keep the
  panel bounded.
- The index reads saved bytes from disk, not open editor buffers, so an unsaved edit in a
  module-definition file is picked up only after it is saved. It also uses Node file-system paths, so
  virtual workspaces are not indexed.
- The index decodes UTF-8. An ARXML file that declares UTF-16 or a legacy encoding may be skipped or
  indexed incorrectly.
- A file matching `arxmlScope.index.exclude` stays editable as text but gets no outline, definition,
  references, links, hover or diagnostics from the extension.
- Every index change rebuilds the shared lookup maps. This is fast for ordinary workspaces, but a very
  large workspace can pause briefly after a save.
- The single-file editor model (`core/ecuc/scanner.ts`) and the workspace index
  (`core/index/xmlStream.ts`) are separate parsers. They share the XML text helpers; they converge only
  when cross-file features need one model.
- The Document is read-only by design; edits are limited to `<VALUE>`, container `<SHORT-NAME>` /
  `<DEFINITION-REF>`, and delete/duplicate of a container or parameter.
- CDATA-backed values are displayed but cannot be edited.
- Conditions are evaluated for display only; the extension does not rewrite or remove disabled nodes.
- The page follows the editor theme for colours and fonts. Search uses fixed highlight tiers because
  theme find-match colours may be transparent; high contrast/forced-colours uses outlines instead of
  fills.
- Large files are virtualized, but browser layout/paint cost is not eliminated. Use the benchmark suite
  for scan/row/diff/index timing, not as a promise for every machine.
- Line numbers follow display rows, not XML source lines, so collapsing or filtering renumbers them.
  Their width is at least five characters; there is no line-number setting.
