# Design — expansion as part of the display list

## Seam

`src/editor/filter.ts` is the display-list module. Its interface is `flattenRows(rows, options)` →
`FlatRow[]`; the page (`renderHtml.ts`) is the only production caller, and `virtualPage.test.ts`
evaluates the page's own copy. The page currently reconstructs two facts the module already had:
whether a displayed node is expanded (from the next row's type/level) and which ids are its
ancestors (from `rowById`).

Both facts move behind the existing seam. No new module, no new adapter: one added field on
`FlatNodeRow`, one added function in the same module.

## Interface change

```ts
interface FlatNodeRow {
  type: 'node';
  rowIndex: number;
  depth: number;
  level: number;
  /** The module's own descend decision: children shown below this row. */
  expanded: boolean;
}
```

`expanded` is exactly the local in `flattenRows` that already gates the descend, so it cannot
disagree with the list.

```ts
ancestorIds(rows: readonly FilterRow[], id: string): string[]
```

Nearest parent first, empty for a root or an unknown id. Pure, no DOM, serialisable. The page calls
it with its own `rows` array; the `Map` it builds internally replaces the page's ad-hoc
`rowById` walk.

## Data flow after the change

1. Host pushes `{ type: 'model', rows, selectedId }`.
2. `rebuildDisplay` calls `flattenRows` and maps each node row to `expandedIds` from `flat.expanded`.
3. Rendering reads `expandedIds` exactly as today (`aria-expanded`, twisty state).
4. `expandAncestors(id)` asks `ancestorIds(rows, id)` which ids to delete from `collapsed`, then
   rebuilds the display list as today.

## Compatibility

- The row payload on the wire is unchanged: `expanded` exists only on `FlatRow`, which never leaves
  the page.
- `FlattenOptions` and filtering semantics are untouched.
- Serialisation: `ancestorIds.toString()` joins the existing splice list next to `flattenRows`, so
  the page manifest stays the one place that defines what the page can call.
- `FlatNodeRow` gains a field, so any test that deep-equals a node row must include it; the existing
  tests map `rowIndex`/`type`, so the expected churn is small.
- `resolveGuideHover` keeps its own parent ascent: it seeks the nearest container for a guide, not
  the full ancestor list, so `ancestorIds` is not a general traversal helper.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `expandedIds` drifts from the rendered list | The flag comes from the same expression that gates the descend; AC1 pins all four cases |
| A filtered ancestor shows as expanded while its saved collapsed state says otherwise | Force-expand already lives in that expression; AC1 covers the filter case |
| `ancestorIds` re-derives a map on every reveal | One call per reveal, O(n) over the row list; `rowById` already exists but is rebuilt on every re-scan anyway |
| Page copy and module copy diverge | The page splices `ancestorIds.toString()`; `virtualPage.test.ts` evaluates the page's copy |

## Alternatives rejected

- **Keep the inference, extract a helper.** It moves the same duplicated rule into a third place and
  leaves two owners of expansion.
- **Pass `expandedIds` in the row payload from the host.** The host does not know the collapsed set
  or the filter state; expansion is page state, so it belongs in the display list, not the model.
