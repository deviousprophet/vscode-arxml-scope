# Deepen the ECUC editor: `flattenRows` owns expansion

## Goal

The display list module currently decides which rows are expanded, and then the page works the
same fact out again from the neighbouring row. Move that decision entirely behind the
`flattenRows` interface so the page consumes expansion instead of re-deriving it, and give
ancestor traversal one owner.

## Requirements

- R1. `flattenRows` reports `expanded` on every displayed node row, using the rule it already
  applies to decide whether to descend (children + visible descendant + collapsed/filter state).
- R2. The parent walk used for expansion has one owner: an exported `ancestorIds(rows, id)` returns
  the nearest-first ancestor ids of a row, and the page's `expandAncestors` consumes it instead of
  walking `rowById` itself. The guide-hover walk that looks for the nearest container is a different
  query and stays where it is.
- R3. The page derives `expandedIds` only from `flat.expanded`; it must not inspect the next
  display row's type or level.
- R4. No observable change: same display list, same `aria-expanded` values, same keyboard
  expand/collapse, same filter force-expand, same Document brace rows.
- R5. The page keeps receiving these functions by serialisation; the splice list in
  `renderHtml.ts` remains the single page manifest, with `ancestorIds` added to it.

## Acceptance Criteria

- [ ] AC1. `flattenRows` sets `expanded: true` for an uncollapsed parent, `false` for a collapsed
      parent, `false` for a leaf, and `true` for a collapsed parent that an active filter forces
      open (R1).
- [ ] AC2. `ancestorIds` returns nearest parent first (`['b','a']` for a grandchild) and `[]` for a
      root row and for an id that is not in the list (R2).
- [ ] AC3. The rendered page contains no expansion inference from the next display row, and
      `expandedIds` is filled from the flat row's `expanded` flag (R3).
- [ ] AC4. The suite is green, including the existing `aria-expanded` and virtual-page tests (R4).
- [ ] AC5. `npm run check-types`, `npm run lint` and `npm test` pass; deleting the `expanded` flag
      from `FlatNodeRow` breaks a test (R1, R3).

## Constraints

- No new runtime dependency.
- `filter.ts` keeps no DOM and no VS Code import; its functions stay serialisable to the page.
- The page manifest stays hand-declared in `renderHtml.ts`; no new emitters.

## Out of scope

- The parameter-kind table, `EcucSnapshot`, the presentation module, the page-script registry and
  the scanner element table — the other review candidates.
- Any change to filtering semantics, brace rows, virtual scrolling or row heights.
