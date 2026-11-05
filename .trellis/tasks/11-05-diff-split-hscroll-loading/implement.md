# Implement — split alignment, per-pane horizontal bars, diff loading

1. **Title strip CSS**
   - Grid title strip; remove the cell border; add the `::after` divider at 50%.
   - Update the CSS assertions.

2. **VirtualScroll horizontal bars**
   - Replace the single `hscroll`/`hspacer` with a `.virtual-scroll-hbars` row and one bar per pane.
   - Add `contentWidths`, `horizontalOffsets`, `getViewportFor`, `setScrollLeft(left, pane)`, `getScrollLeft(pane)`, `getHorizontalBar`.
   - Position bars over the pane tracks; wire each native `scroll` event to its own offset.
   - Keep aliases for the first bar.
   - Include `viewport.left` in the window render key so horizontal-only scrolls repaint.
   - Update `virtualScroll.test.ts` for two bars and independent offsets.

3. **DiffView**
   - Render each pane with its own viewport.
   - Forward per-pane widths; reset both horizontal offsets on Swap.
   - Update `diffView.test.ts` and `diffPage.test.ts`.

4. **Loading state**
   - Add `loaded`; show `Loading comparison…`/`aria-busy` until the first document.
   - Clear it in `setDocument`.
   - Add the page test and a CSS busy style.

5. **Docs/spec/changelog**
   - `docs/DIFF.md`: per-pane horizontal bars and loading state.
   - Component specs: VirtualScroll bars/offsets, DiffView title alignment.
   - `CHANGELOG.md` Unreleased.

6. **Verify**
   - `npm run check-types`
   - `npm run lint`
   - `npm test`
   - `npm run benchmark`
   - `npm run package`
   - `npx @vscode/vsce ls`

## Review gates

- **Gate A:** title divider and pane split share x/width.
- **Gate B:** each pane has an independent working horizontal bar; the vertical surface stays shared.
- **Gate C:** initial state is busy, not `No differences`; first document clears it.
- **Gate D:** full tests, benchmark, package and VSIX pass.
