# Semantic Diff

The semantic diff compares two ECUC-Values files by their **configuration**, not by their XML text. It
is a read-only view: it never writes, repairs or generates a file.

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
  **Strict** ÷ **Prev diff** / **Next diff**, with **Swap sides** centered over the pane divider and
  Search on the right. There is no changed/added/removed/renamed count in the page.
- Each pane pins only its file name: the shortest distinguishing label, with the full path in its
  tooltip. Schema and package lines are the first content inside each pane's scroller, so they scroll
  away with the rows. The shorter pane's lines are padded so both panes start their rows at the same y,
  and neither the pinned label nor the meta block is searched.
- Rows are aligned: a line that exists on only one side has a blank cell on the other side. There is no
  blank spacer row between modules; every row is one line high.
- Annotations, braces and bracket guides follow each side of the comparison. Both panes use the same
  Document view as the editor, so annotations, braces, guides, colours and typography match.
- A **read-only** status tint marks added, removed and changed cells; changed words are highlighted
  inside changed rows. Syntax tokens keep their colours.
- Selecting a container or module tints its whole subtree in both panes, including the annotation rows
  of descendant containers. An added or removed row highlights only the pane that owns its cell; the
  blank side stays blank.
- Only the visible window is rendered in each pane. Both panes scroll natively; only the left pane
  shows a vertical scrollbar, and the right one hides it without reserving a gutter. Both panes have
  their own horizontal scrollbar; scrolling either pane or bar mirrors the other, and `Shift+wheel`
  over either pane scrolls both horizontally. `Swap sides` resets the horizontal offsets but keeps the
  vertical position.

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

## Renamed containers

`arxmlScope.diff.semanticMatching` (default `true`) adds one more pairing pass for containers that the
strict rules left unpaired. It lets a renamed container stay one changed row instead of becoming an
add + remove pair, and keeps its children aligned inside it.

- Pairing is attempted only between containers with the same `DEFINITION-REF` and the same parent.
- A score combines the similarity of the children (0.55), the short name (0.30), the relative position
  (0.10) and learned token substitutions (0.05). A pair is accepted at 0.62 or higher.
- A near-tie stays unpaired: the best candidate must beat the second best by 0.08 on both sides, so two
  equally plausible containers are not guessed.
- Consistent token changes across several high-confidence pairs become substitutions (for example
  `NMH→NM`). A later pair can then be accepted because its remaining difference is exactly that
  substitution. Substitutions are learned per comparison and never persisted.
- Children of a semantic pair are compared by their final id segment, so a changed owner name does not
  turn every child into an add + remove pair.
- A renamed container renders exactly like any other **changed** row; there is no badge, no dashed
  underline and no visible count. The pairing still keeps the row and its children aligned.
- Only containers are paired semantically. Parameters and references keep the strict pairing rules.

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

## Context and split lines

The diff toolbar has a **Context** toggle, active by default. In **Show diff** it keeps five
unchanged rows above and below each changed row. It has one fixed value, no menu, and is disabled while
**Show all** is active.

The remaining unchanged runs are replaced by one split line per run: a horizontal rule with
`N unchanged lines` and a chevron. Clicking anywhere on the split row expands the hidden rows; the
row stays as a collapse control, with its accessible label switching between Show and Hide. The
toggle sits in the displayed left pane and follows **Swap sides**; the whole row is clickable in both
panes. Split lines are not selectable and are skipped by `F7` and search.

With **Context** off, only the changed rows and their ancestors remain visible; every hidden run is a
split line. The split line is a display control only; it never changes the comparison result.

## Navigating the diff

| Control / key | Action |
|---|---|
| **Show all** | Show every row, including unchanged rows. |
| **Show diff** | Keep changed/added/removed rows, five context rows above and below each change, and split lines for the hidden runs. |
| **Prev diff** / **Next diff** | Move to the previous/next changed row, wrapping at the ends. |
| `F7` / `Shift+F7` | Same as Next/Prev while focus is in the diff list. |
| **Swap sides** | Mirror the displayed sides; display only, no re-comparison. |
| **Semantic** / **Strict** | Two-button view group for renamed-container pairing. The group flips immediately and a spinner/status shows while the new view is prepared. |
| **Context** | Active by default; keeps five unchanged rows above and below each change in Show diff. Only the toggle changes. |
| Split line | Expand or collapse the unchanged rows hidden under an `N unchanged lines` rule. |
| Row twisty / `Left` / `Right` | Collapse or expand a subtree. |
| `Space` | Select the focused row. |
| `Enter` | Reveal the selected row in its source file. The revealed side follows the displayed pane after a swap. |
| **Search** | Type a query and press `Enter`; `Shift+Enter` goes backwards. `Ctrl+F` / `Cmd+F` focuses the field. |
| **Search count** | `1 / N` or `0 / 0`; the busy slot shows a running chunked search. |

Search jumps and marks; it never hides rows. In **Show diff** the search candidates are the
changed/added/removed rows; in **Show all** they are all rows. Switching the view restarts the committed query
against the new candidate set and preserves the current key where possible. Swapping sides re-projects
the same merged rows, so the search result set does not change.

## Refresh behaviour

- Editing either file schedules one full re-scan after a 150 ms debounce.
- A successful refresh replaces the document but keeps the view mode, swap state, match mode, collapse
  set, selection, search and scroll position where the rows still exist.
- If a side stops being ECUC-Values while the panel is open, the last good comparison stays visible and
  a warning explains why it stopped updating.
- If a refresh throws, the same last-good document stays and the error is shown in the notice strip.
- Closing the panel disposes its listeners and pending refresh timer.

## Limitations

- Read-only: no merge, no apply, no repair, no generated file.
- Both files must be ECUC-Values `.arxml`; other files are refused.
- The comparison is over the display model. It does not compare XML comments, unknown elements or
  attributes the scanner does not model.
- Reference following is a single-file feature; the diff reveals source ranges, it does not build a
  cross-file target index.
- Search and navigation are over the merged display list; there is no filter control, global
  Collapse/Expand or bottom action strip.
- Semantic pairing is a heuristic. A container rename that changes the `DEFINITION-REF`, the parent or
  most of the children stays an add + remove pair; use Strict to see that view explicitly.
- Switching modes does not re-scan either file. A very large diff that contains renames can still
  need one rebuild and one document transfer on the first switch; the toolbar shows a spinner and
  `Switching to …` while that happens.
- `Swap sides` is display-only. The left/right files keep their original comparison roles.
- Very large files remain virtualized in both panes, but paint cost still depends on the machine.
