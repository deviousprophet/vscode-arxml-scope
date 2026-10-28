# ECUC parameter details: types, numeric formats and details-only follow

## Goal

Make the details panel the complete place to inspect and edit a parameter: show its AUTOSAR parameter type, present integer values as decimal/hex/binary, constrain editing to the parameter's type, and remove the redundant hex metadata from the Document. Move reference following out of the Document and into a details-only **Jump to target** action.

## Scope

**In**

- Capture the `DEFINITION-REF DEST` attribute in the scanner/model so the details panel can show the AUTOSAR parameter type.
- Add a details **Type** row: Integer, Float, Boolean, String, Enumeration, Function name, Linker symbol, or a normalized fallback.
- Show integer value formats in details: Decimal, Hexadecimal (`0x0F` style), Binary (`0b00001111` style).
- Remove the `(= 0x…)` metadata from the Document row and the `Hexadecimal` row derived from it.
- Type-aware editing in details:
  - Integer: decimal, hex or binary integer literals.
  - Float: decimal integer/fraction/exponent.
  - Boolean: a true/false selector.
  - Textual/enumeration/function-name/linker-symbol: text.
- Remove reference follow from the Document (no link, click or Enter follow). Add a details-only **Jump to target** button for same-file targets.
- Tests, docs/specs, captures and gates.

**Out**

- A general AUTOSAR schema/type database; only the `DEFINITION-REF DEST` value is used.
- Structural editing, retargeting references, cross-file references.
- A new dependency, asset or icon font.
- Changes outside the parameter type capture/validation needed for this feature.

## Requirements

- **R1 - AUTOSAR type capture.** The scanner records the raw `DEST` attribute of a parameter's `DEFINITION-REF`. The model carries it as an optional `definitionDest` on `ParameterNode`; existing documents without `DEST` still scan.
- **R2 - Type display.** The details panel shows a **Type** row. Map known DEST values to readable names (`ECUC-INTEGER-PARAM-DEF` → Integer, `ECUC-FLOAT-PARAM-DEF` → Float, `ECUC-BOOLEAN-PARAM-DEF` → Boolean, `ECUC-STRING-PARAM-DEF` → String, `ECUC-ENUMERATION-PARAM-DEF` → Enumeration, `ECUC-FUNCTION-NAME-DEF` → Function name, `ECUC-LINKER-SYMBOL-DEF` → Linker symbol). Unknown DEST values are shown normalized; a missing DEST falls back to Numeric/Textual/Boolean from the value kind.
- **R3 - Integer formats.** For an integer type/value, details shows:
  - Decimal, canonical signed decimal;
  - Hexadecimal, uppercase `0x` with at least two digits (`0x0F`, `0x3F`, `-0x0F`);
  - Binary, `0b` with at least eight digits (`0b00001111`, `0b00111111`, `-0b00001111`).
  Non-integer floats show Decimal only. Boolean and textual values show no numeric formats.
- **R4 - No Document hex.** The `(= 0x…)` meta part is removed from the main view. The Document shows the value once; details carries the formats.
- **R5 - Type-aware editing.** The details input follows the type:
  - Integer: accepts decimal, hex (`0x`) and binary (`0b`) integer literals with an optional minus sign; rejects fractions, exponents, booleans and text.
  - Float: accepts decimal integers, decimal fractions and exponent forms; rejects hex/binary/boolean/text.
  - Boolean: a true/false selector; no free text.
  - String/Enumeration/Function name/Linker symbol: text.
  - Unknown/missing type: keep the current numeric/text behavior.
  A refusal still preserves the typed text, marks the field invalid and shows the reason. Enter commits, Escape restores, Tab/Shift+Tab commits and moves.
- **R6 - Details-only reference jump.** A reference target is no longer a link in the Document: no `data-follow`, pointer cursor, hover underline, click follow or Enter follow. The details panel shows **Jump to target** only when the same-file target is followable. Clicking it posts the existing follow message; the provider selects the target in the ECUC editor. Unresolved references have no jump button; **Reveal in source** remains.
- **R7 - Preserve the surface.** Selection, collapse/filter, virtual scrolling, re-scan, focus/roving tabindex, details visibility, `.value` as a direct `.row` child, the write path and dark/HC behavior stay intact.
- **R8 - Verification.** Scanner/model/validation tests, row/detail rendering tests, input-control tests, provider follow tests, docs/specs, dark/HC captures and the full gates.
- **R9 - Empty container marker.** A container with no parameters, references or sub-containers ends in a muted `{ }` marker, so it is visually distinct from a parameter row. It remains a leaf with no fold control.

## Acceptance Criteria

- [x] **AC1** A parameter with `DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF"` exposes `definitionDest` and the details Type row shows Integer; missing/unknown DEST falls back safely.
- [x] **AC2** Integer details show Decimal/Hexadecimal/Binary in the requested formats (`0x0F`, `0b00001111`), without a `(= … )` wrapper; floats show Decimal only.
- [x] **AC3** The Document no longer renders `(= 0x…)` metadata; the value appears once in the main view.
- [x] **AC4** Integer input accepts only integer literal forms; Float input accepts decimal/exponent forms; Boolean uses a true/false selector; textual types remain text; refusals keep text/error.
- [x] **AC5** Reference values are not links in the Document; the details panel has Jump to target only for followable same-file targets, and it selects the target in the ECUC editor.
- [x] **AC6** Existing selection/collapse/filter/re-scan/details/virtual-window behavior is unchanged.
- [x] **AC7** `check-types`, `lint`, `test` and `preview:check` pass; dark/HC/narrow/deep captures show the new details and Document states.
- [x] **AC8** No unrelated core behavior, manifest or dependency change.
- [x] **AC9** An empty container shows a muted `{ }` marker at rest and remains a leaf without a fold control.

## Constraints

- `src/core/**` changes are limited to capturing `DEFINITION-REF DEST`, exposing it on `ParameterNode`, type-aware validation, and removing the now-unused `hexValue` computation/field. Do not introduce a schema database.
- Keep the existing write path and one-`WorkspaceEdit`-per-action rule.
- No new dependency, icon/font asset, CSP change or inline style attributes.
- Hex/binary formats are display-only except as accepted integer input literals.
- Dark is the supported theme; high contrast remains the accessibility variant.
