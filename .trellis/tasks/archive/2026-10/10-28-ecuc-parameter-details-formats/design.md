# Design: ECUC parameter details, formats and details-only follow

Read with `prd.md`. The Document row/window engine, details editor, provider follow path and
`validateValue` write path are already in place; this adds type data and changes where formats and
the follow action surface.

## 1. Data flow

```text
DEFINITION-REF DEST attribute
  -> scanner Rec.definitionDest
  -> ParameterNode.definitionDest
  -> EcucRow.definitionDest
  -> InspectorFields.type + formats
  -> details Type/Decimal/Hexadecimal/Binary rows
```

`src/core/**` changes are deliberately limited to this type capture and type-aware validation.

### 1.1 Scanner

- Add `attrs?: Map<string, string>` to `Entry`, populated for `DEFINITION-REF` only (the parser
  already has the attribute map at that point).
- Add `definitionDest?: string` to `Rec`.
- On closing `DEFINITION-REF`, set `parent.definitionDest = entry.attrs?.get('DEST')?.trim()`.
- Add `definitionDest?: string` to `ParameterNode`; copy it in `toParameter`.
- Missing/empty `DEST` remains `undefined`; no fixture or document is rejected.

### 1.2 Row model

- Add `definitionDest?: string` to `EcucRow`; `parameterRow` copies `parameter.definitionDest`.
- Delete `hexPart` and the hex entry from `parameter.meta`. The Document value is shown once.
- Keep `valueKind` for token colour and fallback type.
- `followable` stays on reference rows for the details action, but no longer drives a Document
  link.

## 2. Type names and formats

### 2.1 Type mapping

| DEST | Type row |
|---|---|
| `ECUC-INTEGER-PARAM-DEF` | Integer |
| `ECUC-FLOAT-PARAM-DEF` | Float |
| `ECUC-BOOLEAN-PARAM-DEF` | Boolean |
| `ECUC-STRING-PARAM-DEF` | String |
| `ECUC-ENUMERATION-PARAM-DEF` | Enumeration |
| `ECUC-FUNCTION-NAME-DEF` | Function name |
| `ECUC-LINKER-SYMBOL-DEF` | Linker symbol |
| other `ECUC-…-PARAM-DEF` | title-cased interior, e.g. `Curve` |
| missing | Boolean/Numeric/Textual from `valueKind` |

The type row is derived in a pure serialized helper so the page and tests share it.

### 2.2 Formats

Only integer values get all three formats:

- Decimal: canonical signed decimal.
- Hexadecimal: uppercase, `0x` prefix, **minimum two digits**. `15` → `0x0F`; `63` → `0x3F`;
  `-15` → `-0x0F`.
- Binary: `0b` prefix, **minimum eight digits**. `15` → `0b00001111`; `63` → `0b00111111`;
  `-15` → `-0b00001111`.
- Values that are not safe integers, or are floats, show **Decimal** only (the raw normalized
  decimal text).
- Boolean and textual values show no numeric format rows.
- Formats are display-only; they never rewrite the file.

Parsing accepts decimal, `0x`/`0X`, and `0b`/`0B` integer literals with an optional leading minus.
Formatting is computed from the parsed value, not from the raw string, so `0x3F` also shows decimal
`63` and binary `0b00111111`.

## 3. Details editing

`detailsValueInput(row, data)` selects a control from the type:

| Type | Control | Input rule |
|---|---|---|
| Boolean | `<select class="details-value">` with `true`/`false` | no free text |
| Integer | text input | sanitize to `0-9 a-f A-F x X b B + -`; commit validates integer literal |
| Float | text input | sanitize to `0-9 . e E + -`; commit validates decimal/fraction/exponent |
| String/Enumeration/Function name/Linker symbol | text input | normal text |
| Unknown/missing | current numeric/text input | current literal rules |

- The sanitizer is a small page-side function; it keeps the caret usable by only replacing the value
  when a disallowed character was inserted. It does not pretend to be full grammar validation.
- `validateValue` becomes type-aware so a crafted/stale message still cannot write a fraction into an
  integer, a boolean into an integer, or text into a numeric parameter. Unknown types keep the
  current `numeric` behavior.
- Enter commits, Escape restores, Tab/Shift+Tab commits and moves. A refusal keeps the typed text,
  marks the field invalid and shows the reason. For the boolean select, Escape restores the original
  option and Enter commits it.
- `focusDetailsInput` uses `select()` only when the control supports it; a `<select>` gets `focus()`.

## 4. Details panel content

For a parameter, the panel order is:

```text
Kind / label
Definition
Short name
Variant
Type
Value input
Decimal (when applicable)
Hexadecimal (integer only)
Binary (integer only)
Conditions / annotations
Actions: [Jump to target] (followable reference only) / Reveal in source
```

`InspectorFields` loses the old `hex` field and gains:

```ts
type: string;
formats: { label: 'Decimal' | 'Hexadecimal' | 'Binary'; value: string }[];
```

The format rows are built in `inspectorFields` from `row.value` and the type, so an offscreen
selection still gets them without reading the DOM.

## 5. Reference follow moves to details

- `valueSpan` never adds `target`/`data-follow`; it shows `Target: <path>` as a plain title.
- Remove the `[data-follow]` branch from `onRowClick`, the follow exclusion from
  `onRowDoubleClick`, and the followable-reference branch from `onTreeKeydown`. A reference now
  selects/reveals like any other row; there is no Document click/Enter follow.
- `updateInspector` adds a `Jump to target` action when `row.kind === 'reference' &&
  row.followable === true`. It calls the existing `followItem(row.id)` / `{type:'follow'}` message.
- Unresolved references get no jump button. Reveal in source stays for every row.
- The provider's follow resolution and target selection are unchanged.

## 6. Tests and docs

- Core: scanner captures DEST (with and without namespace), model carries it, validation accepts the
  type's literals and refuses the others.
- Row: `definitionDest` carried; no hex meta; reference rows still carry `followable` for details.
- Page/details: type row, format rows/scaling, boolean select, integer/float sanitizers, refusal
  behavior, details-only jump action, no Document `data-follow`.
- Provider: the existing follow test still selects the target; unresolved target has no action.
- Docs/specs: `docs/ECUC_EDITOR.md`, `docs/ECUC_EDITOR_DESIGN_SPEC.md`, frontend component/quality/
  testing guidelines.
- Captures: parameter with integer formats, boolean details, reference details with Jump to target,
  reference without target, Document without `(= 0x…)`.

## 7. Risks and rollback

| Risk | Mitigation |
|---|---|
| Scanner DEST capture changes parsing | Optional field; existing fixtures without DEST still pass |
| Type validation breaks existing numeric edits | Keep the current fallback when DEST is unknown; add scanner/validation tests for all known types |
| Format padding is arbitrary | Fixed minimums documented in the PRD (`0x0F`, `0b00001111`); tests pin them |
| `<select>` breaks input-only code (`select()`, value reset) | Guard `select()` and test Enter/Escape/Tab on the boolean control |
| Removing Document follow breaks keyboard users | Details action is keyboard reachable; Enter on the row reveals; Reveal remains |
| Core/editor coupling | Only `definitionDest` crosses the boundary; no schema database or UI type in core |

Rollback: revert this task's commit. The row/window engine and write path otherwise stay as they are.
