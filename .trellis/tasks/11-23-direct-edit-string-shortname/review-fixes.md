# Review fixes — decisions after the two-axis review

These decisions supersede the earlier design where they differ. The goal is to keep the
verified Ctrl+S-only behavior while removing the standards violations and closing the two
correctness gaps found by the spec axis.

## 1. Host supplies the renamed node id

- Add optional `nextNodeId?: string` to the host `editResult` message.
- The host already computes `plan.nextNodeId` in both the legacy and engine paths. Return it
  from `EditOutcome` and include it in `editResult`.
- Webview `RenameIntent` stores the host `nextNodeId` from the ack. Do **not** re-derive a
  container id from its short name or parse the ordinal.
- Remove `renamedNodeId`, `CONTAINER_ID` and the ordinal-stripping branch from `editOrder.ts`.
  `remapNodeId` becomes a plain application of the host pair to the renamed node and its
  descendants (`oldId` / `oldId + '/'` prefix). No id grammar is interpreted or predicted.
- `resolveRenameIntents` resolves only when the host pair is present, the old row is gone and
  `rowById` has the host-provided new id (container with the expected short name).
- Keep descendant prefix application because a value draft under the renamed container can be
  in flight; it applies the host pair rather than inventing the id.
- **Implementation note:** the final code keeps the parent-path prefix branch for nested child
  ids, where the child id embeds the parent path without the parent ordinal. The host pair is
  still the only source of the new id; this one application is documented as the editor
  exception in `type-safety.md`, not a predicted id.
- Update the preview rename ack to include `nextNodeId`, and the extension tests to assert it.
- Update the task design: the protocol gains one optional field, not a new message.

## 2. Stale drafts and refused in-flight edits

- `flushEdits()` must report whether it had to drop a stale draft. `requestSave()` aborts the
  save when that happens; the status must say the node is gone and Ctrl+S stays blocked until
  the user reverts or the row returns.
- Use `RenamePlan.dropped` instead of ignoring it: dropped intents mark their drafts stale and
  cancel a pending save.
- When a rename resolves, re-key `inflightEdits` values' `nodeId` as well as pending/invalid
  entries, so a refusal that arrives after the re-scan is recorded at the new id. The Details
  selection must never target a dead id.
- Add tests: a refusal after the rename document lands; a stale draft during save does not
  post `save`.

## 3. Multi-line paste

- Intercept `paste` on the Monaco container in the capture phase.
- For text containing `\r`/`\n`, prevent the default and insert the text as one line with the
  same newline escaping the synthetic display uses (`\\n`). The field draft then follows the
  normal single-line path.
- Keep single-line paste and cut unchanged.
- Add a preview or unit-level probe for a newline-containing paste if the headless harness can
  dispatch a clipboard event; otherwise document the manual check.

## 4. Multi-row save verification

- Add a committed preview state `editor-multi-save`: edit the textual and decimal values, press
  Ctrl+S, ack both edits, assert two host edits then one save and both visible values.
- This closes the spec axis's missing acceptance evidence.

## 5. Standards cleanup

- Move `editOrder.ts`, `lineEdit.ts` and `valueValidation.ts` to `src/core/ecuc/`.
- Reuse the literal/short-name/definition-ref grammar from `src/core/ecuc/validate.ts` by
  exporting small predicate helpers; do not keep a second grammar copy in the page.
- Narrow the new `any` in `detailsEditor.ts` and the blind `as` in `captureDetailsFocus` with
  `instanceof` and the DOM types.
- Remove the unused `RenamePlan.dropped` (or use it for §2), inline `forgetRenameIntent`,
  dedupe `spanTextForRaw`/`displayForRaw`, and use one node/field key builder for `editKey` and
  `fieldKey`.
- Update `quality-guidelines.md`: a Ctrl+S save may flush one edit per changed field (one undo
  step per field); an inspector rebuild is allowed when it re-seeds drafts and restores
  focus/caret. Update `editor-lifecycle.md` for the host `nextNodeId` field.
- Keep the existing preview states and the 962-test baseline green.
