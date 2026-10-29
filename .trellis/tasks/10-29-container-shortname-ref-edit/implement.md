# Implement — container short name / definition ref editing

Ordered execution plan. Each group ends at a gate that must be green before the next starts.

## 0. Preconditions

- Branch: `feat/container-shortname-ref-edit` (created from `origin/main` at 9fc7f4b).
- Task: `.trellis/tasks/10-29-container-shortname-ref-edit`.
- Read before editing:
  - `.trellis/spec/frontend/quality-guidelines.md` (write-path rules, details editor ownership)
  - `.trellis/spec/frontend/component-guidelines.md` (DOM contracts, inspector)
  - `.trellis/spec/frontend/testing.md` (bytes, refusals, hand-authored expectations)
  - `.trellis/spec/frontend/state-management.md` (host/webview split, persisted state)
  - `design.md` (contracts in this task)

## 1. Core validation — `src/core/ecuc/validate.ts`

- [ ] Add `validateShortName(input)` and `validateDefinitionRef(input)` returning the existing
      `ValidationResult`, with the patterns and refusal text from `design.md` §4.
- [ ] Factor the XML-legal check + `escapeXml` so value validation and the new validators share it.
- [ ] Keep `validateValue` behaviour and messages unchanged.
- [ ] Unit tests in `src/test/core/validate.test.ts`: accept legal names/refs; refuse empty,
      whitespace, `/` in a short name, leading digit, relative ref, `//`, XML-illegal character.

Gate 1: `npm run check-types && npm run lint` and the core validate suite
(`npm run compile-tests` then `npx mocha --ui tdd "out/test/core/validate.test.js"`).

## 2. Write path — `src/editor/ecucEdit.ts`

- [ ] Widen `EditRegion` with `'shortName' | 'definitionRef'`.
- [ ] Add `nodeFor(model, nodeId)`; keep `parameterFor` (test/API compatibility).
- [ ] Widen `regionOf` to `EcucNode`; short name / definition ref resolve their recorded ranges;
      value/element keep the parameter rule; CDATA still refuses for every region.
- [ ] Add `buildFieldEdit(model, text, nodeId, field, value)`; container-only; unchanged check;
      validation before the record; refuse when the field element has no text content.
- [ ] Add `nextNodeId` to the success plan for the two new fields (predicted text → scan →
      smallest containing node; reuse `nodeIdForRange`).
- [ ] Generalise `applyEdit` to `nodeFor` + widened `regionOf`; keep the oldText comparison and
      exactly one `WorkspaceEdit`.
- [ ] Tests in `src/test/editor/editing.test.ts` (pure section):
      plan shape for both fields, container-only refusal, unchanged refusal, region slice includes
      no tag/attribute bytes, predicted id differs after a rename and is unchanged after a ref edit.

Gate 2: types + lint + `out/test/editor/editing.test.js` pure tests green.

## 3. Provider routing — `src/editor/ecucEditorProvider.ts`

- [ ] Extend `WebviewMessage` with `field?: 'value' | 'shortName' | 'definitionRef'`.
- [ ] Replace `editValue` with `editField(document, key, panel, nodeId, field, value)`:
      build value/field plan, set `selections` to `plan.nextNodeId` before `applyEdit`, restore
      the previous selection on refusal, post the existing warn `notice`, keep one refresh path.
- [ ] Route `message.field ?? 'value'`; ignore unknown fields.
- [ ] Tests (same file as editing):
      - rename through the stub panel → document bytes change only in `SHORT-NAME`, last `model`
        payload has `selectedId` = new id and rows show the new short name;
      - definition-ref edit → container still selected, row label follows the new tail;
      - refused container edit → no mutation, no dirty flag, `notice` posted, selection restored.

Gate 3: `npm run check-types && npm run lint` and the editing suite green.

## 4. New editing fixtures

- [ ] Add `src/test/fixtures/editing/container.arxml` (module + container with `DEST` and two
      parameters, one sibling container).
- [ ] Add hand-derived expected files:
      `container-short-name.expected.arxml` (one `SHORT-NAME` line changed) and
      `container-ref.expected.arxml` (one `DEFINITION-REF` inner text changed, `DEST` intact).
- [ ] Add byte-for-byte provider tests on temp copies: short-name edit, definition-ref edit, and
      one undo/redo assertion for each. Never write the committed fixture.

Gate 4: fixture hashes unchanged after a full run (the existing AC9 pattern).

## 5. Webview details editor — `src/editor/ecucDetailsEditor.ts`

- [ ] Replace `detailsEdit` with `detailsEdits` keyed by field; keep `pendingMove`; add
      `pendingFieldFocus`.
- [ ] Keep `detailsValueInput(row, data)` as the entry point and its parameter behaviour; add
      `shortName` / `definitionRef` text inputs for container rows (ids/`data-field` from
      `design.md` §6.2).
- [ ] `commitDetailsEdit(field)` posts `{ type: 'edit', nodeId, field, value }`; `pending` and
      `notice` handling attach to the right field; Escape restores that field's original.
- [ ] Tab on a container field commits and focuses the other container field after the re-scan;
      Tab on the value field keeps the existing adjacent-parameter move.
- [ ] `beginDetailsEdit(rowId, field?)` defaults to the first editable field for the row.
- [ ] Clear all field state on `{ type: 'model' }`, then run the pending focus/move timers.
- [ ] Update `src/editor/renderHtml.ts` `updateInspector`: replace the read-only
      `Definition`/`Short name` rows with the controls for `row.kind === 'container'`; keep them
      read-only for other kinds; parameter `Value` stays where it is.

Gate 5: types + lint + `uxDocumentInteractions.test.ts`, `uxDocument.test.ts` (details parts),
`virtualPage.test.ts` green.

## 6. Details visible by default + icons — `src/editor/renderHtml.ts`

- [ ] `uiState` default `{ inspectorHidden: false }`; saved-state branch unchanged.
- [ ] Static `<aside id="inspector">` without `hidden`; details toggle starts
      `aria-pressed="true"` with `Hide node details` title/aria-label.
- [ ] Replace the Collapse/Expand SVG path data with the chevron pair from `design.md` §6.4; add
      `stroke-linejoin="round"`; keep ids, labels, titles and aria labels.
- [ ] Update tests:
      `uxDocument.test.ts` (default shell, persistence default, toggle assertions),
      `uxPolish.test.ts` (shell default), and add a path-data assertion that the two buttons
      differ and follow R7.
- [ ] Do not weaken the existing `applyInspectorVisibility` behaviour tests: both states still
      drive `hidden`, `aria-pressed`, title and aria-label.

Gate 6: types + lint + the UX suites green.

## 7. Docs and changelog

- [ ] Update `.trellis/spec/frontend/quality-guidelines.md`: "Defaults are Document and hidden
      details" → visible details; "Details editing is the only value edit path" → value + container
      short name/definition ref and the `field` message; write-only `<VALUE>` wording → only the
      edited element's text.
- [ ] Update `.trellis/spec/frontend/component-guidelines.md`: inspector fields, message shape,
      default visibility.
- [ ] Update `.trellis/spec/frontend/state-management.md`: default visible, persisted explicit
      hide.
- [ ] `CHANGELOG.md` under `[Unreleased]`: added container short name/definition ref editing,
      details visible by default, distinct expand/collapse icons.

## 8. Full verification

```bash
npm run check-types
npm run lint
npm test
```

- [ ] All three green.
- [ ] Mutation spot-checks (each must fail a test):
      - remove the `shortName` validator → refusal test fails;
      - drop `nextNodeId` → rename-selection test fails;
      - restore `inspectorHidden: true` default → default shell test fails;
      - restore the old identical-looking SVG paths → icon-difference test fails;
      - write the element span instead of the inner text → byte comparison fails.
- [ ] Extension Development Host pass (record as host-observed, not CI):
      1. Open `src/test/fixtures/basic.arxml` with `Open with ECUC Editor`;
         details is open on first paint.
      2. Select `ContA`; edit Short name to `ContA1`; Enter → row and details update, selection stays.
      3. Edit Definition to `/PkgA/ModDefs/ModA/ContA1`; Enter → label follows the tail.
      4. Tab between the two container fields; Escape restores a draft; invalid input shows the reason.
      5. Hide Details, reload the webview → stays hidden; show → stays visible.
      6. Compare the Collapse and Expand buttons at 14px in dark and high contrast.
      7. Undo once per edit restores the previous bytes.

## Rollback points

| After | Rollback |
|---|---|
| Gate 2 | revert `validate.ts` + `ecucEdit.ts` changes; no other layer touched |
| Gate 3 | revert provider routing; webview still works with the old message |
| Gate 5 | revert details editor + inspector; value editing returns to the previous state |
| Gate 6 | revert shell/icons only; editing and default can ship independently if needed |

No data migration, no manifest change, no new persisted key. A full revert leaves the repository
at `origin/main` behaviour.

## Out of scope (do not implement)

- Reference `TARGET-REF` editing, module rename, adding missing elements, rename propagation,
  CDATA editing, bulk edits, a second renderer, or changing the path-based node id scheme.
