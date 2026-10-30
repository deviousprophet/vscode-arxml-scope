# Semantic ARXML diff view — technical design

## 1. Architecture

```
vscode command
  └─ src/commands.ts (compare handlers)
       ├─ src/diff/compareSelection.ts   session-only left-file stash
       └─ src/diff/diffPanel.ts          WebviewPanel lifecycle
            ├─ workspace.openTextDocument + scanEcucValues
            ├─ buildRows(left/right)     existing display rows
            ├─ src/diff/diffModel.ts     match + status + order + summary
            └─ src/diff/diffPage.ts      HTML shell + serialized page script
                 ├─ src/editor/rowView.ts        shared label/value/meta primitives
                 └─ src/editor/virtualScroll.ts  window math

src/core/ecuc/*  stays pure. src/diff/diffModel.ts has no vscode import.
```

The diff is read-only. It never uses `WorkspaceEdit`, `writeFile`, `applyEdit`, or the repair path
from the reference extension.

## 2. Comparison model

### 2.1 Inputs

Both sides are converted with the production row builder:

```ts
const sortOptions = { sort: 'all' as const, sortExcept: SORT_EXCEPTIONS };
const leftRows = buildRows(leftModel, sortOptions).rows;
const rightRows = buildRows(rightModel, sortOptions).rows;
```

Using `sort: 'all'` with the fixed default exception list (not the user's workspace setting) makes
both sides use the same deterministic order. This is deliberate: a diff must not change because one
pane was sorted differently.

`EcucRow.id` is the semantic identity (module definition-ref + short name; container path + short
name; parameter/reference container path + name + duplicate ordinal). Producing rows also gives the
label, shown value, value kind, meta chips and parameter type from one implementation.

### 2.2 Projection

The page does not need every `EcucRow` field. The host projects each side once:

```ts
export interface DiffCell {
  kind: EcucRow['kind'];
  label: string;
  shortName?: string;
  definitionRef: string;
  shownValue?: string;
  valueKind?: EcucRow['valueKind'];
  value?: string;
  target?: string;
  meta: MetaPart[];
  range: Range;
}

export type DiffStatus = 'unchanged' | 'changed' | 'added' | 'removed';

export interface DiffChange {
  /** Human label: value, target, short name, definition ref, variant, condition, context. */
  field: string;
  left: string;
  right: string;
}

export interface DiffRow {
  key: string;
  parentKey: string | null;
  level: number;
  kind: DiffCell['kind'];
  hasChildren: boolean;
  /** Recomputed over the merged tree. */
  subtreeSize: number;
  status: DiffStatus;
  left?: DiffCell;
  right?: DiffCell;
  changes: DiffChange[];
  /** Lower-cased label + short name + shown value from both sides. */
  haystack: string;
}

export interface DiffSummary {
  changed: number;
  added: number;
  removed: number;
  unchanged: number;
}

export interface DiffDocument {
  left: { name: string; path: string };
  right: { name: string; path: string };
  rows: DiffRow[]; // pre-order, children contiguous
  summary: DiffSummary;
}
```

### 2.3 Matching

Recursive sibling matching over the two pre-order lists:

1. Index right children by `id`.
2. For each left child, pair with the right child of the same `id`.
3. Exact leftovers: group by `baseId` (the id with its trailing `#<ordinal>` removed). If exactly one
   leftover exists on each side for a base id, pair them. This absorbs a reorder of same-named
   siblings without reporting a false add/remove.
4. Remaining left → `removed`; remaining right → `added`.
5. Recurse into paired containers/modules.

A row's status is `added`/`removed` from the pass; a paired row is `changed` if `diffChanges()`
returns at least one entry, else `unchanged`.

### 2.4 Changed fields

Compare these projections and emit one `DiffChange` per differing field:

| Field | Left / right source |
|---|---|
| `value` | `row.value` (parameters) |
| `target` | `row.target` (references) |
| `short name` | `row.shortName` |
| `definition ref` | `row.definitionRef` |
| `variant` | `meta` part with `cls === 'variant'` |
| `condition` | `meta` part(s) with `cls === 'condition'` |
| `context` | `row.contextPaths` joined, or the `context` meta part |

`label`, `shownValue` and `definitionDest` are derivatives of the fields above and do not get
separate entries. Annotation meta (`cls === 'annotation'`) is deliberately ignored: a comment-only
change is not a configuration change.

### 2.5 Merged order

For each parent:

```
out = []
queued = map<leftChildId | null, rightOnlyChild[]>
for each right child in order:
    previous matched left id (or null) = nearest earlier right sibling that paired with a left row
    if right child is right-only: queued[previous].push(child)
append queued[null]
for each left child in left order:
    append left child (paired or removed)
    append queued[left child id] (right-only additions)
```

Paired children are then recursed with the same rule. Left order is preserved; additions sit next
to their right-side context. After the merge, one pre-order walk recomputes `level`, `parentKey`,
`hasChildren`, `subtreeSize`, `posinset` and `setsize` from the merged tree; these are not copied
from either side.

### 2.6 Summary

`changed`, `added` and `removed` count every row with that status, including descendants of an
added/removed container. `unchanged` counts the rest.

## 3. Page contract

### 3.1 Shell

`renderDiffHtml(document, { nonce })` returns a static shell:

- CSP `default-src 'none'; style-src 'nonce-…'; script-src 'nonce-…'`.
- Toolbar: left/right file labels, text filter (`type="text"`), changes-only checkbox, summary,
  previous/next change buttons, expand/collapse all.
- Two sticky pane headers, one `#diff-list` (`role="tree"`) containing `#diff-top`,
  `#diff-window`, `#diff-bottom`.
- `#diff-detail` strip and `#diff-notice` banner.
- `<script type="application/json" id="diff-rows">` with the initial `DiffDocument`.
- One inline page script assembled from serialized pure functions plus DOM glue.

No dynamic model text is put in an HTML string. Static shell text is escaped; rows are built with
`document.createElement` and `textContent` (the existing `require-escaped-html` rule still applies).

### 3.2 Shared row primitives

Child 1 extracts the page functions `appendHighlighted`, `valueSpan` and `metaSpan` from
`renderHtml.ts` into `src/editor/rowView.ts`:

```ts
export function rowViewScript(): string {
  return `${appendHighlighted.toString()}${valueSpan.toString()}${metaSpan.toString()}`;
}
```

`renderHtml.ts` injects `rowViewScript()` before `TREE_SCRIPT` and removes the local copies. The
diff page injects the same script. `appendHighlighted` already accepts an explicit query and falls
back to the global `filterQuery`; the diff page declares `let filterQuery = ''` and updates it on
input. `valueSpan`/`metaSpan` operate on any object with the `EcucRow` field subset, so a
`DiffCell` works unchanged. A test asserts the two pages contain byte-identical function bodies.

### 3.3 Visibility and flattening

Pure functions in `diffModel.ts`, serialized into the page and unit-tested:

```ts
export function diffVisibility(
  rows: readonly DiffRow[],
  query: string,
  changesOnly: boolean
): { visible: boolean[]; matchCount: number; visibleCount: number };

export interface FlatDiffRow { rowIndex: number; level: number; expanded: boolean }

export function flattenDiffRows(
  rows: readonly DiffRow[],
  options: { collapsed?: ReadonlySet<string>; visible?: readonly boolean[] }
): FlatDiffRow[];

export function nextChangeIndex(
  rows: readonly DiffRow[],
  visible: readonly boolean[] | undefined,
  from: number,
  direction: 1 | -1
): number; // -1 when there is no change
```

- A row matches when it is visible by text (`haystack.includes(query)`) and, with changes-only, its
  status is not `unchanged`. A backward pass marks ancestors of matches, like `filterRows`.
- Flattening skips collapsed subtrees unless a visible descendant exists during an active filter,
  so ancestors of a change are always reachable.
- `nextChangeIndex` searches visible rows with `status !== 'unchanged'`, wraps, and returns the
  source row index.

### 3.4 Rendering

One `.diff-row` contains two `.diff-cell` children. A cell is built by a page function
`buildDiffCell(cell, side, query)`:

- `span.twisty` placeholder for alignment (containers only; empty for leaves).
- `span.label` with `appendHighlighted`.
- `valueSpan(cell)` for parameters/references.
- `metaSpan(cell)` when `meta.length > 0`.
- `data-status` on the row, `data-empty` on a missing side.
- `row.className = 'node diff-row'`, `role="treeitem"`, `aria-level`, `aria-expanded`,
  `aria-selected`; an `sr-only` span names the status (`added`, `removed`, `changed`).
- A container row occupies two lines (row height includes the module/container gap) only when the
  existing editor's module gap applies; otherwise every row is one fixed height so the two panes
  stay aligned.

Click selects `key` in both cells; the detail strip is filled from `row.changes` and the two cells.
`ArrowUp`/`ArrowDown` move selection, `ArrowLeft`/`ArrowRight` collapse/expand, `Enter` reveals,
`F7`/`Shift+F7` call next/previous change.

### 3.5 Virtual scroll

Reuse `virtualScrollScript()` unchanged. The page keeps `displayRows = flattenDiffRows(...)` and a
height function equal to the measured row height plus the module gap, like the ECUC Document view.
Only `[start, end)` plus a 10-row buffer is built. `#diff-top` / `#diff-bottom` heights come from
`calcRowOffset`; total height from `calcTotalHeight`. A hidden probe row supplies the measured
height and is re-measured on resize.

## 4. Host panel

### 4.1 Panel lifecycle

```ts
export class DiffPanel {
  static readonly viewType = 'vscode-arxml-scope.diff';
  static async open(context, leftUri, rightUri): Promise<void>;
}
```

- Create the panel with `enableScripts: true`, `retainContextWhenHidden: true`.
- Title uses `compareTitle(left, right)`; same basenames are disambiguated by the shortest
  trailing path suffix (ported rule from the reference).
- Open both documents with `workspace.openTextDocument`; validate with `gateReason`; scan both.
- Render the shell with the initial `DiffDocument`.
- `ready` settles a `watchBoot` timer (10 s) and is otherwise a no-op because the initial document
  is already embedded.
- `reveal` message `{ side: 'left' | 'right', key }`: find the row and its cell range, open the
  corresponding document, and call
  `revealRangeInTextEditor(doc, range, { viewColumn: panel.viewColumn, mode: 'beside' })`.
  Forcing `beside` keeps the diff tab alive even when the user configured `replace`.
- Refresh: `onDidChangeTextDocument` for either URI, 150 ms debounce, re-scan both, rebuild, post
  `{ type: 'diff', document }`. The page keeps filter, changes-only, collapse, selection and scroll.
- If `gateReason` now fails, post `{ type: 'error', message }` and keep the last document.
- Dispose the debounce timer, both listeners, and the panel with the panel.

### 4.2 Commands and manifest

`src/diff/compareSelection.ts`:

```ts
export class CompareSelectionStore {
  get(): vscode.Uri | null;
  set(uri: vscode.Uri): void;   // also setContext 'arxmlScope.hasCompareSelection' true
  clear(): void;                // also setContext false
}
export function fileName(uri: vscode.Uri): string;
```

`src/commands.ts` adds:

| Command | Behaviour |
|---|---|
| `vscode-arxml-scope.selectAsFirst` | validate + stash + info message |
| `vscode-arxml-scope.compareToStaged` | stash left, clicked right; warn when no stash |
| `vscode-arxml-scope.compareSelected` | Explorer two-selection; palette fallback opens a two-file dialog |

The palette fallback uses `vscode.window.showOpenDialog({ canSelectMany: true, filters: { ARXML:
['arxml'] } })` and requires exactly two files. Validation is `gateReason(await
openTextDocument(uri))`; failures show one warning and stop.

Manifest additions (the submenu itself is created by the sibling child task):

```json
"commands": [
  { "command": "vscode-arxml-scope.selectAsFirst", "title": "Select as First File to Compare", "category": "ARXML Scope" },
  { "command": "vscode-arxml-scope.compareToStaged", "title": "Compare with First File", "category": "ARXML Scope" },
  { "command": "vscode-arxml-scope.compareSelected", "title": "Compare Two ARXML Files…", "category": "ARXML Scope" }
]
```

Items in `arxmlScope.actions`:

| Item | `when` |
|---|---|
| `selectAsFirst` | `resourceExtname == .arxml && !listMultiSelection && explorerViewletFocus` |
| `compareToStaged` | `resourceExtname == .arxml && !listMultiSelection && explorerViewletFocus && arxmlScope.hasCompareSelection` |
| `compareSelected` | `resourceExtname == .arxml && listDoubleSelection && explorerViewletFocus` |

No diff command is added as a flat `editor/context` entry; the editor submenu keeps its two
existing actions.

## 5. Compatibility

- Existing `renderHtml` output keeps the same DOM after the row-primitive extraction; existing tests
  assert the function bodies and still find them.
- No persisted state is added. The compare stash is session-only.
- No new activation event, dependency, default editor association, or file write.
- `buildRows` is unchanged except for the optional condition fields added by child 4; the diff
  ignores them for status (conditions are compared as text meta, not evaluated state).

## 6. Trade-offs

- **Path identity, not move detection.** A container moved under another parent is a remove + add,
  because its ECUC path changed. This is semantically accurate and keeps matching simple.
- **Fixed sort order.** The diff ignores the user's sort setting. Both sides therefore compare in
  the same order; the on-screen order may differ from the editor's current sort.
- **Full recompute per change.** Diffing is O(rows) on the host after a debounce, not incremental.
  This is simpler and fast for ECUC file sizes; the page only renders a window.
- **Unsaved buffers are compared.** This is what users expect from an editor diff, but it means the
  panel can differ from the bytes on disk until the document is saved.
- **Duplicate sibling reorders.** The base-id fallback handles the common one-to-one reorder; an
  ambiguous duplicate set still degrades to add/remove, which is safe and visible.

## 7. Rollback

New `src/diff/**` files plus one manifest block and the `rowView` extraction. Reverting the feature
removes the commands and menu items; no other surface imports the diff modules. The rowView
extraction is behaviour-preserving and can be kept or reverted independently.
