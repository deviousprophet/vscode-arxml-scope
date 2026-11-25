# Legacy DOM renderer interaction reference

> **Retired.** The Document surface is the Monaco editor described in
> [ECUC_EDITOR.md](../user/ECUC_EDITOR.md). This page records the pre-Monaco DOM renderer's interaction
> model because its vocabulary still appears in old issues and reviews. Nothing here describes current
> behaviour and it is not a specification for new work.

The retired renderer built the Document from per-row DOM elements inside one custom virtual-scroll
surface. It kept its own selection, focus, gutter, folding and copy model rather than delegating to an
editor.

## Row model

- Modules, containers, parameters and references were emitted in display order, one `.node` row per
  ECUC row.
- A fixed line-number gutter numbered each display line from 1: header rows, the blank separator, module
  gaps, annotations, braces and nodes. The gutter stayed fixed while rows scrolled horizontally and
  scrolled with them vertically.
- The selected row repeated its 2px rail on the number cell so the indicator stayed visible beside the
  opaque gutter; diff status tinted the same cell.
- The selected row background, rail and subtree tint spanned `max(100%, content width)` so a long row
  scrolling in or out did not change the highlight width.
- The page precomputed row offsets, including headers and module gaps, so the scrollbar thumb matched
  the content; one virtual-scroll surface owned the vertical scroll and row offsets.

## Roving focus and keys

Focus was a roving `tabindex` across the rendered rows; the row list, not a text cursor, owned the
keyboard.

| Key | Action |
|---|---|
| `Up` / `Down`, `Home` / `End`, `PageUp` / `PageDown` | Move the roving focus through the rendered rows. |
| `Left` | Collapse the focused container, or move to its parent. |
| `Right` | Expand the focused container, or move to its first child. |
| `Space` | Select the focused row. |
| `Enter` | A parameter opened its Details value editor; a container with children toggled; a leaf, empty container or reference revealed in source. |
| `Ctrl+Enter` / `Alt+Enter` | Reveal the focused row in source. |
| `F2` | Open a parameter's Details value editor. |
| A single character | Type-ahead jump to the next visible label with that prefix. |

## Folding and copy

- Containers drew `{` and `}` brace rows; a collapsed container showed a ` { … }` hint and stayed
  collapsible from the fixed 26px fold gutter.
- Selecting text across rows copied one line per row, indented by `4 * (level - 1)` spaces and built
  from the visible label, value, meta chips, disabled suffix, header text and brace/comment text. A
  selection inside one row stayed on the browser's native copy path.
- The line-number gutter, fold control, indent guides, blank separators and sidebar chrome were
  non-selectable.

## Why it was replaced

The custom surface had to reimplement selection, scrolling, folding, find, sticky scroll, minimap and
undo. Monaco already owns those behaviours, so the current page serializes the same rows into a
synthetic ECUC document and maps the editable field spans back to the row model. The current contract
is in [`monaco.md`](../../.trellis/spec/frontend/monaco.md).
