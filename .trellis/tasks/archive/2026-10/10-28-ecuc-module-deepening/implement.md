# Implementation plan

## 1. Display-list module (`src/editor/filter.ts`)

- [x] Add `expanded: boolean` to `FlatNodeRow` (comment: the module's own descend decision).
- [x] Emit `expanded` in the node push, using the same expression that gates the descend.
- [x] Add `ancestorIds(rows, id)`: nearest parent first, `[]` for a root or unknown id; no DOM.
- [x] Keep `flattenRows`' options, brace rows and filter semantics untouched.

## 2. Display-list tests (`src/test/editor/filterRows.test.ts`)

- [x] Four `expanded` cases: uncollapsed parent, collapsed parent, leaf, filter force-expand.
- [x] `ancestorIds`: grandchild returns nearest-first; root and unknown id return `[]`.
- [x] Keep the existing rowIndex/type assertions passing unchanged.

## 3. Page (`src/editor/renderHtml.ts`)

- [x] Import `ancestorIds` and add `${ancestorIds.toString()}` to the splice list beside `flattenRows`.
- [x] `rebuildDisplay`: drop the next-row inference; fill `expandedIds` from `flat.expanded`.
- [x] `expandAncestors`: delete `ancestorIds(rows, id)` from `collapsed` instead of walking `rowById`.

## 4. Page-level guard (`src/test/editor/virtualPage.test.ts`)

- [x] Assert the page no longer infers expansion from the next display row.
- [x] Assert the page's own `ancestorIds` copy resolves a grandchild the same way the module does.

## 5. Validation

- [x] `npm run check-types`
- [x] `npm run lint`
- [x] `npm test` (full suite, expect 224+ passing)
- [x] Mutation: remove `expanded` from the node push/`FlatNodeRow` and confirm a test fails
      (AC5), then restore.
- [ ] Re-read the rendered page in the Extension Development Host for a fixture with nested
      containers: twisties and `aria-expanded` unchanged (needs a human pass; not available in
      this session).

## Review gates

- Gate A after step 2: module tests green before the page changes.
- Gate B after step 4: full suite green before the spec update.
- Rollback point: the branch is `refactor/ecuc-module-deepening`; reverting steps 3-4 restores the
  previous page behaviour with the module change inert.

## Notes

- Source-level assertions: the `rebuildDisplay` wiring checks (no `next.type`, reads
  `flat.expanded`) inspect `functionSource` text. The behaviour they guard is driven separately by
  the `expanded` flag tests in `filterRows.test.ts` and the `expandAncestors` test in
  `virtualPage.test.ts`. Recorded here per `testing.md`.

## Spec update (phase 3.3)

- Record in `.trellis/spec/frontend/state-management.md` that expansion is owned by `flattenRows`
  and the page consumes `expanded`; no second derivation from neighbouring rows.
