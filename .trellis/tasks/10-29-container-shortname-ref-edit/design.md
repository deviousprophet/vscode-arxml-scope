# Design — container short name / definition ref editing

## 1. Scope and ownership

The change crosses four existing boundaries and adds no new module:

| Layer | Owns | File(s) |
|---|---|---|
| Model | `shortNameRange` / `definitionRefRange` are already captured by the scanner | `src/core/ecuc/model.ts`, `scanner.ts` (no change expected) |
| Validation | what a legal short name / definition ref is, and the escaped bytes to write | `src/core/ecuc/validate.ts` |
| Write path | resolving the node and region from a fresh scan, the edit record, one `WorkspaceEdit` | `src/editor/ecucEdit.ts` |
| Host routing | message → plan → apply, and keeping the selection on the renamed node | `src/editor/ecucEditorProvider.ts` |
| Webview | which fields are editable, the input state machine, the details default, icons | `src/editor/ecucDetailsEditor.ts`, `src/editor/renderHtml.ts` |

`src/core/**` keeps its no-`vscode` rule. The webview keeps building text nodes; no `innerHTML`
from model text is introduced.

## 2. Message contract

Generalise the existing edit message with an optional `field`:

```ts
type EditField = 'value' | 'shortName' | 'definitionRef';

interface WebviewMessage {
  type?: string;
  nodeId?: string;
  field?: EditField;   // absent => 'value' (backward compatible)
  value?: string;
}
```

- Parameter value: `{ type: 'edit', nodeId, value }` — unchanged; the existing tests and the
  refusals keep working.
- Container short name: `{ type: 'edit', nodeId, field: 'shortName', value }`.
- Container definition ref: `{ type: 'edit', nodeId, field: 'definitionRef', value }`.

The host normalises `message.field ?? 'value'`. An unknown `field` is ignored (no write).

## 3. Write path (`ecucEdit.ts`)

### 3.1 Region model

`EditRegion` grows from `'value' | 'element'` to:

```ts
export type EditRegion = 'value' | 'element' | 'shortName' | 'definitionRef';
```

`EcucEditRecord` keeps `{ nodeId, region, oldText, newText }`. A short-name/definition-ref
record is a plain **inner text** replacement (the scanner's ranges are already the trimmed
text content), so no element wrapper is needed. `value` / `element` keep the existing
parameter-only semantics, including the CDATA refusal.

`regionOf` is widened from `ParameterNode` to `EcucNode`:

```ts
regionOf(node: EcucNode, text: string, region: EditRegion):
  { range: Range; oldText: string } | undefined
```

- `shortName` → `node.shortNameRange`
- `definitionRef` → `node.definitionRefRange`
- `value` / `element` → existing `parameter.valueRange` rules; refuse when the node is not a
  parameter.
- All regions still refuse when they touch a CDATA section.

`parameterFor(model, nodeId)` stays (tests use it); add `nodeFor(model, nodeId)` that returns
any `EcucNode` from `buildNodeIndex(model).byId`.

### 3.2 Building a plan

Keep `buildEdit(model, text, nodeId, value)` exactly as the value plan builder (default
`region` inference unchanged) and delegate to a shared core. Add:

```ts
export function buildFieldEdit(
  model: EcucDocumentModel,
  text: string,
  nodeId: string,
  field: 'shortName' | 'definitionRef',
  value: string
): EditPlan
```

Rules:

1. Resolve the node by id; refuse `the node is no longer in the file`.
2. Require `kind === 'container'`; refuse `the node is not a container` for other kinds.
   Module renames are deliberately out of scope: a module short name is part of every
   container's path, so one write would renumber the whole tree.
3. Validate with `validateShortName` / `validateDefinitionRef`; a refusal carries its reason.
4. Resolve `regionOf(node, text, field)`; refuse when the element has no text content.
5. Build `record.oldText` from the slice and `record.newText` from the validation's escaped
   text. An unchanged (trimmed) input is refused before escaping.

### 3.3 Predicting the post-edit id

A container id embeds its short name (`container:<owner>/<shortName>#<ordinal>`), so a rename
invalidates the id used to select it. If the host pushed the re-scan with the old id, the page
would drop the selection and empty the details panel.

`EditPlan` gains an optional outcome:

```ts
export interface EditPlanOk {
  ok: true;
  record: EcucEditRecord;
  /** The id of the edited node after the write; differs for a rename. */
  nextNodeId?: string;
}
```

When the region is `shortName` or `definitionRef`, build the predicted text
(`text[0..start) + newText + text[end..)`), scan it, and resolve the smallest node containing
the predicted range. Reuse `nodeIdForRange` from `navigation.ts` for that rule (exact match
first, then smallest containing node) so the id rule is not duplicated. Value edits skip this
scan and leave `nextNodeId` undefined.

The prediction is only a selection hint: `applyEdit` still re-scans and refuses if the bytes
moved, so a stale prediction can never cause a wrong write.

### 3.4 Applying

`applyEdit(document, record)` resolves `nodeFor(...)` instead of `parameterFor(...)` and uses the
widened `regionOf`. Everything else — oldText comparison, `LineIndex` positions, one
`WorkspaceEdit`, "VS Code refused the edit" — is unchanged. Error strings stop assuming a
parameter: use the node's short name (or definition-ref tail) as the description.

## 4. Validation (`validate.ts`)

Two pure functions, sharing the XML-legal check and `escapeXml`:

```ts
export function validateShortName(input: string): ValidationResult
export function validateDefinitionRef(input: string): ValidationResult
```

- Short name: reject empty; reject anything not matching
  `/^[A-Za-z_][A-Za-z0-9_]*$/` with
  `"<input>" is not a valid short name (letters, digits and underscores, not starting with a digit)`.
- Definition ref: reject empty; reject whitespace, XML-unrepresentable characters, and
  anything not matching `/^\/[^\s/<>"'&]+(\/[^\s/<>"'&]+)*$/` with
  `"<input>" is not a valid definition reference path (an absolute /-separated path)`.
  Segments stay permissive (hyphens etc.) so a legitimate meta-model path is not refused;
  only structure and XML hazards are enforced.
- Both return the escaped text (`escapeXml`) on success. Structurally valid input contains no
  escapable characters, so the escape is a safety net rather than a transformation.

Unchanged is detected by comparing the trimmed raw node text (`ContainerNode.shortName` /
`.definitionRef`) inside the builder, not in the validators, so the message can name the field
(`the short name is unchanged` / `the definition ref is unchanged`).

## 5. Provider routing (`ecucEditorProvider.ts`)

Rename `editValue` to `editField` with a `field` parameter and route from the message listener:

```ts
const field = message.field ?? 'value';
if (message.type === 'edit' && typeof message.value === 'string') {
  void this.editField(document, key, panel, message.nodeId, field, message.value);
}
```

`editField`:

1. Read text, scan once, call `buildEdit` (value) or `buildFieldEdit` (the two fields), so the
   existing refusal → `notice` path is shared.
2. If `plan.nextNodeId` exists and differs from `nodeId`, set `this.selections` to it **before**
   `applyEdit`. The `onDidChangeTextDocument` push that follows the write then already carries
   the surviving id; no extra model push and no second refresh path.
3. `applyEdit`. On success, done. On refusal, restore the previous selection entry, post the
   existing warn `notice`, and do not touch the document.
4. Never post a `model` message here: the existing subscription remains the single refresh path.

The stub-panel tests in `editing.test.ts` drive this method through the same listener.

## 6. Webview (`ecucDetailsEditor.ts` + `renderHtml.ts`)

### 6.1 Details editor state

Replace the single `detailsEdit` object with a map keyed by field:

```js
let detailsEdits = {};    // field -> { rowId, field, input, error, pending, original }
let pendingMove = null;   // existing parameter-to-parameter Tab move
let pendingFieldFocus = null; // { rowId, field } after a container-field Tab
```

- `detailsSelectionChanged(rowId)` clears the map when the selected row differs.
- Each input registers its own edit entry for its field; an inspector rebuild for the same
  selection and field restores the draft text and the refusal message.
- On `{ type: 'model' }` the map is cleared (the existing stale-state rule) and the pending
  move/field-focus timers run after the tree handler has rebuilt the inspector.
- The warning `notice` is attached to the edit whose `pending` flag is set.

### 6.2 Controls

Generalise `detailsValueInput(row, data)` into a field builder while keeping that name and its
parameter behaviour (tests extract the function by name):

- Parameter `Value`: unchanged — typed input or Boolean `<select>`, `id="details-value"`,
  `data-field="value"`, `data-value-kind`/`data-value-type`, the existing input sanitizer for
  Integer/Float, Enter commits, Escape reverts, Tab commits and moves to the adjacent parameter.
- Container `Short name`: text input, `id="details-short-name"`, `data-field="shortName"`,
  current `data.shortName`; Enter commits, Escape reverts, Tab commits and focuses the next
  container field.
- Container `Definition`: text input, `id="details-definition-ref"`,
  `data-field="definitionRef"`, current `data.definitionRef`; same keys.
- Both container controls post `{ type: 'edit', nodeId, field, value }` through
  `commitDetailsEdit(field)`.
- The read-only `Definition` / `Short name` rows are emitted only for non-container rows, so a
  container never shows the same fact twice.

`beginDetailsEdit(rowId, field?)` keeps its signature (existing call sites pass only the id);
the default field is `value` for parameters and the first available container field otherwise.
Focus helpers: `focusDetailsInput()` keeps focusing `#details-value` (tested contract);
`focusDetailsField(field)` focuses the named field.

### 6.3 Visibility default

- `uiState` default becomes `{ inspectorHidden: false }`.
- The saved state still wins when `inspectorHidden` is a boolean; a missing/invalid state
  leaves it visible.
- The static `<aside id="inspector">` loses its `hidden` attribute; the toggle starts with
  `aria-pressed="true"`, `title`/`aria-label` `Hide node details`.
- `applyInspectorVisibility` is unchanged in logic and still runs before the first
  `updateInspector()`, so the toggle and panel agree on paint.

### 6.4 Icons

Replace the two near-identical diagonal glyphs with a vertical chevron pair. Same 14px,
`stroke="currentColor"`, `stroke-width="1.5"`, `stroke-linecap="round"`, plus
`stroke-linejoin="round"`:

- Expand all (spread outward): `M4 6.25 8 2.25l4 4M4 9.75l4 4 4-4`
- Collapse all (squeeze inward): `M4 2.25l4 4 4-4M4 13.75l4-4 4 4`

Labels, `title`, `aria-label` and button ids stay exactly as they are.

## 7. Data flow

```
details input (field)
  → commitDetailsEdit(field)
  → postMessage { type:'edit', nodeId, field, value }
  → provider: buildEdit / buildFieldEdit (fresh scan + validation)
      refusal → postMessage { type:'notice', kind:'warn' } → input stays invalid + reason
      plan    → predict nextNodeId → set selections → applyEdit (one WorkspaceEdit)
  → onDidChangeTextDocument → re-scan → postMessage { type:'model', rows, selectedId:<new id> }
  → page: setRows/reconcile (id survives) → rebuild display → updateInspector
```

## 8. Decisions and trade-offs

- **Container-only, not module.** A module id contains its short name and its path owns every
  container; allowing it would require re-selecting a whole subtree. The requested scope is the
  container, so the write path refuses other kinds and the panel only renders the editors for
  containers.
- **Predicted id vs. changed id scheme.** Keeping path-based ids is a project invariant; adding
  an opaque stable id would ripple through reveal, follow, tests and persisted collapse state.
  One predicted scan per container edit is cheap and cannot corrupt a write.
- **Validate short names strictly, refs structurally.** AUTOSAR identifiers have a defined
  grammar, so a bad short name is a real modelling error. Reference paths vary in segments
  across meta-models, so only structure/XML hazards are enforced there to avoid false refusals.
- **Inner-text writes, no re-serialisation.** The ranges the scanner already records are used,
  so `DEST`, prefixes, attributes and line endings survive byte-for-byte. No new writer.
- **Details visible, preference respected.** The default flips to visible, but an explicit hide
  is stored, so a user who wants the old layout keeps it across reloads.
- **Two editable fields, one undo step each.** Each commit posts one record; no batching, which
  keeps the existing "one action = one undo step" rule.

## 9. Compatibility, rollout, rollback

- No file format or package manifest change; no new dependency; no new persisted key.
- Old webview code sending `{ type:'edit', nodeId, value }` still resolves as `value`.
- Old saved webview state `{ inspectorHidden: boolean }` is read the same way; only the
  fallback changes.
- Rollback is a normal revert: the scanner/model never changed, the write path is additive, and
  a reverted webview ignores the new `field` key.

## 10. Verification map

| Concern | Check |
|---|---|
| Byte-exact writes | New editing fixtures + full-file comparison (hand-derived) |
| Refusals | Invalid short name / ref / unchanged / stale bytes: text, disk and dirty flag |
| Undo/redo | One command per edit, same pattern as the existing AC4 test |
| Selection after rename | Provider stub: last `model`/`select` payload carries the new id and rows show the new short name |
| Details default | Static shell + `applyInspectorVisibility` extracted from the page; saved-state cases |
| Icons | Path-data assertions that the two buttons differ and the labels stay |
| Real DOM | Extension Development Host: edit both fields, Tab between them, hide/show, icons |
