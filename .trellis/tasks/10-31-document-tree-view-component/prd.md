# Reusable DocumentTreeView with virtual scrolling

## Goal

Make the Document tree a real reusable component, the same way Hex Scope reuses `HexView` in both the main hex view and the two-pane diff. The editor gets one instance; the diff gets one per pane. Both keep virtual scrolling for large files and render identical Document rows.

## Requirements

**One component**

- A `DocumentTreeView` component owns the tree scroller, rendered window, spacers, header and Document row markup/styles.
- The editor mounts one instance.
- The diff mounts two instances, one per pane, exactly as Hex Scope's `DiffView` owns two `HexView` instances.
- No second row renderer and no copied token variables in the diff.

**Document parity**

- Each pane shows schema/package lines, annotations, braces, bracket guides, Document colours, font, gutter, indentation and meta typography.
- Diff status is an optional component input; the editor never passes it.

**Virtual scrolling**

- Both panes render only their visible window plus overscan, with top/bottom spacers.
- Large-file scroll stays bounded: one frame does O(visible rows), never O(all rows), and no full DOM rebuild when the visible slice is unchanged.
- The editor keeps its current virtual behaviour and measurements.

**Scroll sync**

- Vertical: the diff panes stay synchronized by logical row position; either pane can be the driver.
- Horizontal: each pane has its own scrollbar; moving either writes the same offset to both.
- Shift+wheel over either pane scrolls both horizontally; plain wheel stays vertical.
- Swap resets both horizontal offsets to zero and keeps vertical position.

**Layout**

- The horizontal scrollbar is fully visible; no fixed height shorter than the native scrollbar.

## Constraints

- The component must not import the diff model, the editor sidebar or any host state.
- Hosts own the row model, view mode, selection and search; the component owns DOM rendering and scrolling.
- CSP rules unchanged.
- No word wrap.
- No bottom strip.

## Acceptance Criteria

- [ ] The editor and diff import the same `DocumentTreeView`; changing one row style changes both.
- [ ] Diff token colours, container colours, font and spacing match the editor exactly.
- [ ] Diff panes show annotations, braces, guides and schema/package headers.
- [ ] Both panes virtualize; a 10k-row document renders only the visible window.
- [ ] Scrolling a 10k-row diff stays responsive; no full-list DOM.
- [ ] Either pane drives synchronized vertical scrolling; either bar drives synchronized horizontal scrolling.
- [ ] Shift+wheel over either pane scrolls both horizontally.
- [ ] Swap resets horizontal offsets; vertical stays.
- [ ] The horizontal scrollbar is not clipped.
- [ ] `npm run check-types`, `npm run lint`, `npm test`, `npm run package` pass.
