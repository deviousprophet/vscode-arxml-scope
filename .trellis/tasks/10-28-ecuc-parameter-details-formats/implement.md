# Implementation plan: ECUC parameter details, formats and details-only follow

Read with `prd.md` and `design.md`. Keep the row/window engine, details editor and provider write
path. The only core changes are `DEFINITION-REF DEST` capture and type-aware validation.

## Order

- [x] 1. **Scanner/model type capture**: add `Entry.attrs` for `DEFINITION-REF`, `Rec.definitionDest`,
  `ParameterNode.definitionDest`; copy it in `toParameter`. Add scanner/model tests including a
  namespaced `DEFINITION-REF` and a missing `DEST`.
- [x] 2. **Type-aware validation**: update `validateValue`/literal helpers for integer, float,
  boolean and textual DESTs; keep the current fallback for unknown types. Add acceptance/refusal tests
  for each.
- [x] 3. **Row model**: add `EcucRow.definitionDest`; remove `hexPart` and the hex meta; keep
  `valueKind` and `followable`. Update row tests.
- [x] 4. **Formatting helpers**: add pure serialized type/format helpers (`parameterType`,
  `parameterFormats`) with the documented padding and sign rules. Add unit tests for decimal, hex,
  binary, negative/zero, fractions and unknown values.
- [x] 5. **Inspector fields**: replace `InspectorFields.hex` with `type` and `formats`; build formats
  from the row value and type. Update `updateInspector` to render Type and format rows.
- [x] 6. **Details controls**: choose `<select>` for Boolean; set integer/float input rules and
  sanitizers; guard `select()` and update Enter/Escape/Tab/refusal behavior. Add page tests for the
  control choice and filters.
- [x] 7. **Details-only follow**: remove `target`/`data-follow` from `valueSpan`, remove Document
  click/Enter follow, add the details `Jump to target` action for followable references, and keep
  Reveal. Add interaction/provider tests.
- [x] 8. **Docs/specs**: update `docs/ECUC_EDITOR.md`, `docs/ECUC_EDITOR_DESIGN_SPEC.md`, and the
  frontend component/quality/testing guidelines for type/formats/editing/follow.
- [x] 9. **Visual QA**: capture integer details with dec/hex/bin, boolean details, reference details
  with/without Jump to target, and the Document with no hex meta.
- [x] 10. **Gates**: `check-types`, `lint`, `test`, `preview:check`; mutation checks for the new
  contracts; record results.
- [x] 11. **Review/commit/archive**: run the two-axis review against this PRD/design/implement,
  fix findings, commit and archive the task.

## Test coverage

| Area | Tests |
|---|---|
| Scanner/model | DEST captured, namespace stripped, missing DEST, optional field compatibility |
| Validation | Integer dec/hex/bin; float integer/fraction/exponent; boolean true/false; text; refusals |
| Row model | `definitionDest`, no `hex` meta, value/target/context unchanged |
| Formats | `0x0F`/`0b00001111`, negative/zero, fractions, unknown, no formats for boolean/text |
| Details | Type row, format rows, input/select choice, sanitizer, Enter/Escape/Tab, refusal |
| Follow | no Document link/click/Enter; details Jump button for followable; no button unresolved |
| Docs/specs | User guide, design spec, frontend component/quality/testing |
| Visuals | integer/boolean/reference details, Document without hex meta, dark/HC/narrow |
| Gates | type/lint/test/preview:check + mutations |

## Mutation checks

| Mutation | Result |
|---|---|
| Drop `DEFINITION-REF DEST` capture | caught by scanner DEST test |
| Show every parameter as Integer | caught by row type/format test |
| Remove hex padding | caught by `0x0F` format test |
| Re-add a Document follow link | caught by reference no-link test |
| Hide the details Jump to target | caught by details follow test |
| Use a text input for Boolean | caught by Boolean-control test |
| Accept fractions as integers | caught by AUTOSAR type validation test |

Final run: **7/7 caught**.

## Gates

```bash
npm run check-types
npm run lint
npm test
npm run preview:check
```

Start the preview harness for captures, stop it, remove generated `.html` files, and record the
results in the task.

## Implementation record (2026-10-28)

Status: implementation, verification, captures, review and commit complete; archive follows.

### Delivered

- `src/core/ecuc/scanner.ts`: captures `DEFINITION-REF DEST` into `Rec.definitionDest`/`ParameterNode.definitionDest`; removed the unused `hexValue` computation.
- `src/core/ecuc/model.ts`: optional `ParameterNode.definitionDest`.
- `src/core/ecuc/validate.ts`: type-aware integer/float/boolean literal rules; unknown/missing DEST keeps the legacy numeric/text rule.
- `src/editor/renderRows.ts`: carries `definitionDest`, normalized `parameterType` and Decimal/Hexadecimal/Binary `formats`; removed the `(= 0x…)` meta and `hexPart`.
- `src/editor/renderHtml.ts`: details Type/formats rows; no Document hex meta; reference values are plain text; details-only `Jump to target`; no Document click/Enter follow.
- `src/editor/ecucDetailsEditor.ts`: type-aware controls (integer/float sanitizers, Boolean true/false select, text), `original` reset, guarded `select()`, and the existing commit/cancel/Tab/refusal flow.
- Docs/specs and five captures updated.

### Verification

- `npm run check-types`: pass.
- `npm run lint`: pass.
- `npm test`: **217 passing**.
- `npm run preview:check`: pass.
- Mutation table: **7/7 caught**.
- Visual captures: `document-no-hex.png`, `details-integer.png`, `details-boolean.png`, `details-reference.png`, `details-reference-missing.png`, `details-integer-hc.png`, `details-integer-narrow.png`, `details-deep.png`.

### Review record

- Two-axis review completed; findings fixed: type-safe input insertion (no silent rewrite), BigInt formats, Float/unknown format gating, fallback validation unchanged, prototype-safe type map, Boolean-invalid fallback, empty-container marker, docs/specs and HC/narrow/deep captures.

## Done when

- [x] AC1-AC9 in `prd.md` pass.
- [x] Type/formats/editing/follow are implemented; no Document hex meta or follow link remains.
- [x] Core changes are limited to DEST capture, type-aware validation and removal of the unused `hexValue` computation.
- [x] Full gates and mutation checks pass; captures recorded.
- [x] Docs/specs updated; preview server stopped; task committed and archived.
