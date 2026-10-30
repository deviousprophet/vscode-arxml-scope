# SW-SYSCOND evaluation — technical design

## 1. Architecture

```
src/core/ecuc/syscond.ts          pure tokenizer + parser + three-valued evaluator
src/editor/conditionValues.ts     host store (workspaceState) + entry parsing/validation
src/editor/renderRows.ts          evaluates each node's own condition; propagates disabled state
src/editor/renderHtml.ts          Conditions toolbar panel + row/detail presentation
src/editor/ecucEditorProvider.ts  owns the store, handles the `conditions` message, re-pushes rows
src/extension.ts                  injects a ConditionValueStore over context.workspaceState
```

The page never evaluates conditions. It submits raw `{ name, value }` entries and renders the
derived `condition` / `disabled` fields on rows. One evaluator, one source of truth.

## 2. Core evaluator (`src/core/ecuc/syscond.ts`)

No `vscode` import. Public API:

```ts
export type ConditionValue = string | number | boolean;
export type ConditionState = 'true' | 'false' | 'unknown';

export interface ConditionResult {
  state: ConditionState;
  /** Every identifier referenced by the expression, in source order. */
  symbols: string[];
  /** Identifiers with no supplied value. */
  missing: string[];
  /** Parse or comparison reason when the result is unknown. */
  error?: string;
}

export function evaluateSyscond(
  text: string,
  values: ReadonlyMap<string, ConditionValue>
): ConditionResult;

export function parseConditionValue(raw: string): ConditionValue;
```

### 2.1 Grammar

```
expr       := or
or         := and ( '||' and )*
and        := equality ( '&&' equality )*
equality   := relational ( ('==' | '!=') relational )*
relational := unary ( ('<' | '<=' | '>' | '>=') unary )*
unary      := '!' unary | primary
primary    := number | string | 'true' | 'false' | identifier | '(' expr ')'
```

- Number: `[+-]?0x[0-9a-f]+` or `[+-]?(\d+(\.\d*)?|\.\d+)`.
- String: single or double quoted; `\\`, `\'`, `\"` escapes.
- Identifier: `[A-Za-z_][A-Za-z0-9_.\-/]*`.
- Whitespace is skipped between tokens.
- Any other character, an empty token stream, or a missing closing parenthesis is a parse error.

### 2.2 Three-valued semantics

The parser returns `boolean | undefined`, where `undefined` is unknown.

| Operation | Rule |
|---|---|
| `!x` | invert true/false; unknown stays unknown |
| `a && b` | false if either is false; unknown if no false and one is unknown; true otherwise |
| `a \|\| b` | true if either is true; unknown if no true and one is unknown; false otherwise |
| `==`, `!=` | require the same runtime type (number, boolean, string); compare accordingly; mixed types → unknown |
| `<`, `<=`, `>`, `>=` | both operands must be numbers; otherwise unknown with a reason |

Unknown propagates the first reason; `missing` lists all unresolved identifiers and `error` holds
the first syntax or type reason.

### 2.3 Identifier lookup

1. Exact key match in the supplied map.
2. Otherwise the last `/` segment of the identifier, if present, is looked up.
3. Otherwise the identifier is missing → unknown.

Name matching is case-sensitive. A literal `true`/`false` is parsed as a boolean, never as an
identifier.

### 2.4 Value parsing

`parseConditionValue` trims and classifies:

- `true` / `false` (case-insensitive) → boolean.
- `0x…` (optional sign) → number.
- decimal integer/float → number.
- quoted string → unescaped string.
- anything else → the trimmed string itself.

This function is used by the host when it converts entries into the evaluation map. The raw string
is what gets persisted, so the UI round-trips exactly what the user typed.

## 3. Entry validation and storage (`src/editor/conditionValues.ts`)

```ts
export interface ConditionEntry { name: string; value: string }

export interface ParsedConditions {
  /** Trimmed, de-duplicated (last wins), invalid rows removed. */
  entries: ConditionEntry[];
  values: Map<string, ConditionValue>;
  invalid: string[];
}

export function parseConditionEntries(input: unknown, limit = 200): ParsedConditions;

export class ConditionValueStore {
  constructor(memento: vscode.Memento, key = 'arxmlScope.conditionValues.v1');
  load(): ConditionEntry[];
  save(entries: readonly ConditionEntry[]): Thenable<void>;
  clear(): Thenable<void>;
}
```

- Input must be an array; each item must have string `name` and `value`.
- Name is trimmed; blank names are dropped. The name pattern is
  `/^[A-Za-z_][A-Za-z0-9_.\-/]*$/`; failures go to `invalid` and are not stored.
- Values are trimmed, length-capped at 200 characters; names at 200.
- At most 200 entries. Later duplicates replace earlier ones (the map insertion position is kept).
- `load` runs the stored value through the same normalization, so a hand-edited or old value cannot
  crash the editor.
- The store is injected into the provider; without one (unit tests), the provider keeps entries in
  memory for the panel lifetime.

## 4. Row integration (`src/editor/renderRows.ts`)

### 4.1 Types

```ts
export interface RowCondition {
  text: string;                 // scanner's syscond text, without brackets
  state: ConditionState;
  reason?: string;              // missing symbols or parse/type reason
  missing?: string[];
}

export interface EcucRow {
  // ...existing fields...
  /** Present only when the node has its own SW-SYSCOND. */
  condition?: RowCondition;
  /** True when this row or any ancestor condition is false. */
  disabled?: boolean;
  /** Why this row is disabled; absent when it is not. */
  disabledBy?: 'self' | 'ancestor';
}

export interface MetaPart {
  // ...existing fields...
  /** Condition chip state, so the page can style it without parsing text. */
  state?: ConditionState;
}
```

`MetaPart.state` is optional; all existing consumers ignore it.

### 4.2 Build options and context

```ts
export interface RowBuildOptions {
  sort?: SortMode;
  sortExcept?: readonly string[];
  conditions?: ReadonlyMap<string, ConditionValue>;
}
```

`BuildContext` gains `conditions`. The recursive builders gain a `disabledByAncestor: boolean`
argument:

- Module: evaluate own condition; `disabled = ancestor || own === false`; pass `disabled` to its
  containers.
- Container: same; pass `disabled` to members and nested containers.
- Parameter/reference: same; no children.

For each node with a condition:

```ts
const result = evaluateSyscond(node.syscond, ctx.conditions);
const ownFalse = result.state === 'false';
row.condition = {
  text: node.syscond,
  state: result.state,
  reason: result.error ?? missingText(result.missing),
  missing: result.missing,
};
row.disabled = disabledByAncestor || ownFalse;
row.disabledBy = ownFalse ? 'self' : disabledByAncestor ? 'ancestor' : undefined;
```

Nodes without a condition can still be `disabledBy: 'ancestor'`.

`suffixParts(node, condition)` sets the condition chip:

- `text: [condition]` unchanged;
- `state: condition.state`;
- `title: [condition] — false (missing: X, Y)` / `unknown (syntax error)` / `true`.

Ancestor propagation is a boolean passed down during the existing pre-order walk, so no second
tree traversal and no per-row ancestor search.

### 4.3 Filter and diff impact

- The filter haystack is unchanged; disabled rows remain searchable and visible.
- The diff compares condition text only (existing meta), not the evaluated state. A different value
  map must not make two files look different.

## 5. Provider

`EcucEditorProvider` gains an optional constructor dependency:

```ts
constructor(private readonly conditionStore?: ConditionValueStore) {
  this.conditionEntries = conditionStore?.load() ?? [];
}
```

Existing tests that call `new EcucEditorProvider()` keep working; entries are then in-memory.

- Initial render includes:
  ```ts
  renderHtml(model, {
    ...editorSettings(),
    conditions: parseConditionEntries(this.conditionEntries).values,
    conditionEntries: this.conditionEntries,
    nonce,
    selectedId,
  });
  ```
- `push()` includes the same `conditions` map, so any row rebuild (document change, settings
  change, condition change) uses one evaluation pass.
- New webview message:
  ```ts
  { type: 'conditions', entries: Array<{ name: string; value: string }> }
  ```
  Validate with `parseConditionEntries`; cap and normalize; store normalized entries in memory;
  `void this.conditionStore?.save(entries)`; if `invalid.length > 0`, post a `notice` with
  `kind: 'warn'` and no row mutation from the invalid rows. Then `push()`.
- The message handler checks shape before use. Unknown fields and non-array `entries` are ignored.
- No document write is involved; only `workspaceState`.

`extension.ts` creates `new ConditionValueStore(context.workspaceState)` and passes it to the
provider.

## 6. Page

### 6.1 Toolbar and panel

After the filter group, add:

```html
<button id="conditions-toggle" class="tool icon-tool" type="button"
        aria-pressed="false" aria-expanded="false" aria-controls="conditions-panel"
        title="Enter SW system-constant values">
  <svg …sliders icon…></svg><span class="lbl">Conditions</span>
</button>
```

After `#notice`, add a shell panel (never rebuilt by `setRows`, so input focus survives a re-scan):

```html
<div id="conditions-panel" class="conditions-panel" hidden>
  <div class="conditions-head">
    <span class="conditions-title">Condition values</span>
    <span id="conditions-count" class="conditions-count" hidden></span>
    <span class="grow"></span>
    <button id="conditions-add" class="tool" type="button">Add value</button>
    <button id="conditions-clear" class="tool" type="button">Clear all</button>
  </div>
  <div id="conditions-list" class="conditions-list"></div>
  <p class="conditions-hint">Values for the SW system constants used by SW-SYSCOND, for example
    <code>CANIPCORETYPE_SC = 1</code>.</p>
  <div id="conditions-status" class="conditions-status" role="status" aria-live="polite"></div>
</div>
```

Initial entries are embedded in a JSON script:

```ts
const conditionPayload = encodeJsonForScript(options.conditionEntries ?? []);
...
<script type="application/json" id="ecuc-conditions" nonce="${nonce}">${conditionPayload}</script>
```

`encodeJsonForScript` replaces `<` with `\u003c`, `>` with `\u003e`, `&` with `\u0026`, and line
separators, so a value cannot close the script tag. It is exported and unit-tested.

### 6.2 Behavior

- The page parses `#ecuc-conditions`, renders one `.condition-row` per entry.
- Row markup: name input, `=` punctuation, value input, remove button. All values are set with
  `input.value`, never HTML.
- `Add value` appends an empty row and focuses the name input.
- `Remove` deletes the row; `Clear all` removes every row.
- Any `input` event in the panel schedules a 300 ms debounced message. Add/remove/clear send
  immediately.
- Client-side name validation marks `aria-invalid` and excludes the row from the payload. The host
  validates again.
- Message:
  ```ts
  vscode.postMessage({ type: 'conditions', entries: readConditionEntries() });
  ```
- The panel open state is `conditionsOpen` in a page-local variable, not persisted. The toolbar
  button toggles `hidden`, `aria-pressed` and `aria-expanded`.
- After a `model` push, `applyDisabledCount()` reads `rows.filter(row => row.disabled).length` and
  updates `#conditions-count` (`N disabled`, hidden at zero).

Debounce reuses `createFilterDebouncer(300)`:

```js
let conditionDebouncer = createFilterDebouncer(300);
function scheduleConditions() {
  const payload = JSON.stringify(readConditionEntries());
  conditionDebouncer.schedule(payload, function (text) {
    vscode.postMessage({ type: 'conditions', entries: JSON.parse(text) });
  });
}
```

### 6.3 Row and details presentation

- `buildNodeRow` sets `node.dataset.disabled = 'true'` when `row.disabled`, and appends a
  `span.sr-only` with `(disabled by condition)` after the meta.
- `metaSpan` sets `span.dataset.state = part.state` when present and keeps `span.title`.
- Details:
  - `InspectorFields` gains `condition?: RowCondition`.
  - If `row.condition` exists, the inspector shows `Condition` (text), `Condition state`
    (`true` / `false` / `unknown`), and `Condition note` (reason) when present.
  - The existing `Conditions` row excludes the node's own syscond text to avoid duplication; it
    keeps post-build conditions. If the row is disabled by an ancestor and has no own condition,
    show `Disabled by an ancestor condition.`
- CSS:
  - `.node[data-disabled="true"] > .row { opacity: .55; color: var(--vscode-disabledForeground); }`
  - `.condition[data-state="false"] { color: var(--vscode-errorForeground); border-color: currentColor; }`
  - `.condition[data-state="unknown"] { border-style: dashed; color: var(--vscode-descriptionForeground); }`
  - `.conditions-panel`, `.condition-row`, `.condition-name`, `.condition-value`,
    `.condition-remove`, `.conditions-hint` use `--vscode-input-*`, `--vscode-panel-border` and
    `--vscode-font-family`.
  - `.sr-only` standard clip rule.
  - No new hard-coded colours; the existing permitted literals stay the only ones.

## 7. Tests

- `src/test/core/syscond.test.ts` — grammar, precedence, three-valued logic, missing symbols,
  numeric/hex/boolean/string comparisons, mixed types, malformed input, empty input, full-path
  fallback.
- `src/test/editor/conditionValues.test.ts` — entry normalization, invalid names, duplicates,
  limits, value parsing, store round-trip with a fake Memento.
- `src/test/editor/conditions.test.ts` (or extend `renderRows.test.ts`) — row propagation:
  container false disables subtree; parameter false disables itself; unknown does not disable;
  literal false does; reference/module conditions; meta state; `disabledBy`.
- `src/test/editor/uxConditions.test.ts` — page markup, embedded payload escaping, panel script
  functions, debounced message shape, disabled count, inspector rows, no `innerHTML` for entries.
- `scripts/check-webview-boot.cjs` — the existing page boot already covers the new serialized
  functions; add a fixture with a condition if the boot fixture lacks one.

## 8. Trade-offs

- **Manual values only.** No cross-file constant resolution; this is explicitly the MVP.
- **Three-valued logic.** Unknown never disables, which avoids false positives from missing
  constants. A literal false still disables.
- **Strict types.** `1 == "1"` is unknown rather than true; this avoids surprising coercion. Users
  can quote or unquote consistently.
- **Ancestor propagation is visual only.** Disabled rows remain selectable, revealable and
  editable; the extension never refuses an edit because of a condition.
- **Panel state is not persisted.** Values are; the open/closed state is not. This keeps
  `vscode.setState` and the existing state tests unchanged.
- **One value map per workspace.** Two ARXML files in the same workspace share values. That matches
  "manual for now" and avoids per-file storage.

## 9. Rollback

Remove the Conditions toolbar/panel, the `conditions` message and store, the `condition` /
`disabled` row fields, and the evaluator. With no fields set, the editor renders exactly as before.
The evaluator and store are new files with no other consumers.
