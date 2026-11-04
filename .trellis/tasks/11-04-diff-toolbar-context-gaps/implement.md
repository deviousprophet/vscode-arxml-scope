# Implement — diff toolbar, row polish and context gaps

## Ordered checklist

1. **Core visibility and gaps**
   - Add `contextLines` to `diffVisibility`; default 0.
   - Add `DiffGap` and `'gap'` kinds to `DiffDisplayRow`.
   - Add `expandedGaps` to `flattenDiffDocument`; emit one gap row per maximal hidden run; expanded
     gaps keep the header and walk the hidden rows.
   - Add core tests for the 5-line context window and gap expansion.

2. **Toolbar**
   - Replace the single match button with `#diff-mode-semantic` / `#diff-mode-strict` in a
     `view-switch`.
   - Add `#diff-context` as a standalone toggle; default active; disabled in Show all.
   - Add inline SVG icons to every main diff button; use `.tool.diff-tool` vertical layout.
   - Remove `#diff-summary`, `setSummary` and all count output.
   - Update `setMatchMode` to paint both mode buttons and keep the pending status.
   - Add toolbar tests for the two groups, icons/labels, Context state and no summary.

3. **Row styling**
   - Change the added edge to the leading edge.
   - Remove the renamed badge, the `data-rename-implied` marker and the badge/dash CSS.
   - Remove `matchTooltip` if unused.
   - Add CSS/page assertions for the edge and the absence of the badge/dash.

4. **Page**
   - Add `contextActive` (default true) and `expandedGaps`.
   - `refreshVisibility` passes 5 or 0 context lines.
   - Clear `expandedGaps` in `setDocument`; keep them across view switches.
   - Render gap rows and handle `.diff-gap-toggle` clicks; preserve scroll.
   - Wire Context and the Semantic/Strict buttons.
   - Remove summary updates/assertions.

5. **Docs and specs**
   - Update `docs/DIFF.md` for the toolbar groups, context toggle, split lines, no counts and row
     treatment.
   - Update the frontend spec toolbar/diff sections.

6. **Verify**
   - `npm run check-types`
   - `npm run lint`
   - `npm test`
   - `npm run benchmark`
   - `npm run package`
   - `npx @vscode/vsce ls`
   - Manual: `H:\workspace\sample\arxml\diff-cases-left.arxml` vs `diff-cases-right.arxml`; toggle
     Semantic/Strict, Context and the split lines; compare the summary in `diff-cases-README.md`.

## Review gates

- **Gate A:** core context/gap tests pass; existing diff output unchanged with context 0.
- **Gate B:** toolbar/page tests pass; no count text; gap expand/collapse works.
- **Gate C:** full suite, benchmark, package and manual pair check green.
