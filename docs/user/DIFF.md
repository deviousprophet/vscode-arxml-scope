# Semantic Diff

The semantic diff compares two ECUC-Values files by their **configuration**, not by their XML text. It
is a read-only comparison until **Merge** is turned on; with Merge off it never writes, repairs or
generates a file. [Two-way copy merge](MERGE.md) documents the copy actions.

The two panes are Monaco's side-by-side diff editor. The schema and package header lines are shown in
the pane content because VS Code diff headers are chrome, not compared lines. Hidden unchanged regions,
word-level changes, the diff gutter, the hunk toolbar, the sash, the overview ruler and the native body
paint come from Monaco; the ARXML toolbar, the two synthetic documents and the copy actions are the
extension's.

## Selecting the two files

### Compare with a first file

1. In the Explorer, right-click the first `.arxml` file and choose
   **ARXML Scope → Select as First File to Compare**. The file is remembered for this window session
   only.
2. Right-click the second `.arxml` file and choose **ARXML Scope → Compare with First File**.

The stash is one-shot: a successful compare clears it, and **Compare with First File** is hidden again
until another first file is selected. Cancelling or refusing the compare leaves the stash in place.

### Compare two selected files

Select exactly two `.arxml` files in the Explorer and choose
**ARXML Scope → Compare Two ARXML Files…**. The clicked file becomes the left side and the other
selected file becomes the right side.

If the command is run from the Command Palette with no selection, a two-file picker opens. Anything
other than exactly two files is refused with a warning.

Both sides must be readable and must pass the same ECUC-Values gate as the editor. Unsaved buffers are
compared, not just the bytes on disk.

## What the panel shows

- One panel titled `<left> ↔ <right>`, with the two panes side by side.
- The toolbar is icon-over-label: **Show all** / **Show diff** ÷ **Context** ÷ **Semantic** /
  **Strict** ÷ **Prev diff** / **Next diff** ÷ **Merge** ÷ **Collapse** / **Expand**, with
  **Swap sides** centered over the pane divider. Find is a floating widget opened by `Ctrl+F`, not a
  toolbar slot. There is no changed/added/removed/renamed count in the page.
- A fixed file-name strip above the two panes shows the shortest distinguishing label on each side,
  with the full path in its tooltip. It is chrome, not content: it never scrolls.
- Each pane is its own synthetic ECUC document. Schema and package lines are the first content of each
  side and scroll with the rows; they are searchable and focusable but are not ECUC nodes.
- The two sides are independently shaped. A row that exists on only one side has no line in the other
  model, and Monaco paints its native diagonal fill for the missing side. There are no numbered
  placeholder rows and no shared padding between the panes.
- Line numbers are Monaco's per-side model-line numbers. Hiding an unchanged region or folding a
  container hides lines without renumbering the visible ones, and the numbers stay fixed during
  horizontal scrolling.
- Diff status tints, changed-word highlights and the overview ruler are Monaco's theme-aware paints;
  when a theme does not define the diff line colours, the page uses VS Code's subtle dark fallbacks
  instead of opaque blocks. Syntax tokens keep their colours.
- One shared vertical scroll position keeps the panes together; each pane has its own horizontal
  scrollbar. The sash resizes the panes and double-click resets it to 50/50. `Swap sides` resets both
  horizontal offsets but keeps the vertical position.
- Until the first comparison arrives, the panel shows `Loading comparison…` instead of flashing
  `No differences`.

## What counts as a change

Both sides are scanned and ordered with the same `sort: all` rules before comparison. The diff reports
these fields, in this order:

| Change class | What differs |
|---|---|
| `value` | A parameter's raw `<VALUE>` text, or a reference's displayed target path. |
| `shown value` | The displayed quoted/bare form when the raw value matches. |
| `target` | A reference's raw `VALUE-REF` / `TARGET-REF`. |
| `short name` | A container/module `<SHORT-NAME>`. |
| `definition ref` | A node's `<DEFINITION-REF>` text. |
| `definition dest` | The `DEST` attribute on `<DEFINITION-REF>`, so an integer parameter retyped as Boolean is visible. |
| `variant` | The `IMPLEMENTATION-CONFIG-VARIANT` meta. |
| `condition` | A node's `SW-SYSCOND` or post-build condition text. |
| `context` | Instance-reference context paths. |

A row with no differing field is unchanged. A row with one or more differing fields is **changed**, and
a row present on one side only is **added** or **removed**. A container whose descendants changed is
still a container row; its subtree contains the changed rows.

Duplicate-named siblings are paired by exact compared content first, then by their sort identity, then
by id and an ordinal-free base key. This means a reordered duplicate keeps its parameters and
references paired, and a changed duplicate lands on one changed row instead of an add + remove pair.

## Renamed modules and containers

`arxmlScope.diff.semanticMatching` (default `true`) adds one more pairing pass for modules and
containers that the strict rules left unpaired. It lets a renamed module or container stay one changed
row instead of becoming an add + remove pair, and keeps its children aligned inside it.

- Pairing is attempted only between modules or containers with the same `DEFINITION-REF` and the same
  parent.
- Names are compared first, and a single unambiguous rename is enough. Children of a semantic pair are
  compared by their final id segment, so a changed owner name does not turn every child into an
  add + remove pair.
- A near-tie stays unpaired, except when every child is identical: those siblings pair by name and then
  by ordinal position, so index-ordered containers such as `PDU_01`…`PDU_04` stay aligned.
- A renamed module or container renders exactly like any other **changed** row; there is no badge, no
  dashed underline and no visible count. The pairing still keeps the row and its children aligned.
- Only modules and containers are paired semantically. Parameters and references keep the strict
  pairing rules.

A comparison has a deterministic work budget and a large-group fallback. When one applies, the pairs
already found stay visible and a note above the rows reports how many containers were left unmatched
and why. The scoring thresholds and candidate blocking are implementation detail, documented for
contributors.

The toolbar has a **Semantic** / **Strict** view group; selecting one switches the current panel only
and posts the new mode to the host, which rebuilds the comparison without changing the setting. The
group flips immediately and shows a spinner plus `Switching to …` until the new rows arrive. Strict
reproduces the strict output exactly.

Switching reuses the rows and ranges already prepared for the open files. When semantic matching finds
no renames, both modes are identical and the current document stays in place; toggling back after a
document was built for each mode is a cache hit. A very large diff that does contain renames still
needs one rebuild and one document transfer on the first switch, and the toolbar keeps the progress
status visible for that time.

## Inline word changes

A **changed** row highlights the words that actually differ, in both panes, for the fields the row
shows: the label, the value or reference target, the condition, the variant and the reference context.
The text is split into words and punctuation (`0x1F` is one token; `/Pkg/Diff` is `/`, `Pkg`, `/`,
`Diff`), the unchanged tokens are matched, and only the unmatched runs are marked. Unchanged words keep
their normal rendering.

- The displayed left pane uses the removed-text background and edge; the displayed right pane uses the
  inserted-text background and edge. `Swap sides` mirrors the colours with the panes.
- **Added** and **removed** rows keep their full-cell tint and show no word highlight.
- A search match inside a changed word keeps the search background; the changed word keeps its 1px
  outline.
- Short-name and `DEFINITION-REF DEST` changes stay row-level only; the details markers are not part of
  the inline word highlight.

## What is not a change

- XML formatting, indentation, whitespace, attribute order and namespace prefixes.
- Declaration order. Both sides are ordered with the same `sort: all` rules and exceptions, so a
  reordered file compares equal.
- Annotation/comment text. Annotations are displayed but are not compared; a comment-only edit is not a
  configuration change.
- File name or path. Labels are display text; they identify the panes, not the comparison result.

A file that is not ECUC-Values is refused before the panel opens.

## Context and hidden unchanged rows

The diff toolbar has a **Context** toggle, active by default. In **Show diff** it keeps five unchanged
rows above and below each changed row. It has one fixed value, no menu, and is disabled while
**Show all** is active.

The remaining unchanged runs are hidden by Monaco's native unchanged-region control: a horizontal
rule showing how many unchanged lines are hidden, with a chevron. Clicking the row expands the hidden
rows; the row stays as a collapse control, with its accessible label switching between Show and Hide.
The toggle sits in the displayed left pane and follows **Swap sides**; the whole row is clickable in
both panes. Hidden-region rows are not selection targets and are skipped by `F7` and search.

With **Context** off, only the changed rows are kept visible; every hidden run is a native unchanged
region. The control is display-only; it never changes the comparison result.

## Navigating the diff

| Control / key | Action |
|---|---|
| **Show all** | Show every row, including unchanged rows. |
| **Show diff** | Keep changed/added/removed rows, five context rows above and below each change, and a hidden-region control for the rest. |
| **Prev diff** / **Next diff** | Move to the previous/next changed row, wrapping at the ends. |
| **Collapse** / **Expand** | Fold or unfold every container in both panes. |
| `F7` / `Shift+F7` | Same as Next/Prev while focus is in the diff. |
| **Swap sides** | Mirror the displayed sides; display only, no re-comparison. |
| **Merge** | Turn the panel into the two-way copy merge; off by default. See [MERGE.md](MERGE.md). |
| **Semantic** / **Strict** | Two-button view group for renamed-container pairing. The group flips immediately and a spinner/status shows while the new view is prepared. |
| **Context** | Active by default; keeps five unchanged rows above and below each change in Show diff. Only the toggle changes. |
| Fold control | Collapse or expand one container in both panes; the matching container on the other side follows. A small margin dot marks a collapsed container whose subtree hides changed rows. |
| Sticky header | While scrolling, the nearest parent container/module header stays pinned, matching the ECUC editor. |
| **Search** | `Ctrl+F` / `Cmd+F` opens Monaco's native find widget in the focused pane; type a query and press `Enter`; `Shift+Enter` goes backwards. |
| **Search options** | `Aa` case sensitive, `ab|` whole word, `.*` regular expression. The diff has no replace row. |
| **Search count** | Native `1 of N` / `No results`; the matches come from the Rust diff search, not a local scan. |

Search jumps and marks; it never hides rows. In **Show diff** the search candidates are the
changed/added/removed rows; in **Show all** they are all rows. Switching the view restarts the committed query
against the new candidate set and preserves the current key where possible. Swapping sides re-projects
the same merged rows, so the search result set does not change. **Collapse** and **Expand** fold or
unfold every container; the selection, focus and current match do not change.

## Refresh behaviour

- Editing either file schedules one full re-scan after a 150 ms debounce.
- A successful refresh replaces the document but keeps the view mode, swap state, match mode, collapse
  set, selection, search and scroll position where the rows still exist.
- If a side stops being ECUC-Values while the panel is open, the last good comparison stays visible and
  a warning explains why it stopped updating.
- If a refresh throws, the same last-good document stays and the error is shown in the notice strip.
- Closing the panel disposes its listeners and pending refresh timer.

## Limitations

- The comparison itself is read-only. Merge mode is the only write path: with **Merge** off the hunk
  actions are hidden and copies are refused. See [MERGE.md](MERGE.md).
- Both files must be ECUC-Values `.arxml`; other files are refused.
- The comparison is over the display model. It does not compare XML comments, unknown elements or
  attributes the scanner does not model.
- Reference following is a single-file feature; the diff reveals source ranges, it does not build a
  cross-file target index.
- Line numbers follow display lines, not XML source lines: folding or a hidden unchanged region skips
  numbers rather than mapping them to XML lines. There is no configurable line-number width.
- Search and navigation are over the display list; there is no filter control or bottom action
  strip.
- Semantic pairing is a heuristic. A rename that changes the `DEFINITION-REF` or the parent stays an
  add + remove pair. A group above 250,000 candidate pairs uses the name/position fallback, and a
  comparison that reaches its work budget stops scoring. Both cases report the containers they could not
  pair; use Strict to see the unscored view explicitly.
- Switching modes does not re-scan either file. A very large diff that contains renames can still
  need one rebuild and one document transfer on the first switch; the toolbar shows a spinner and
  `Switching to …` while that happens.
- `Swap sides` is display-only. The left/right files keep their original comparison roles.
- Very large files remain virtualized in both panes, but paint cost still depends on the machine.
