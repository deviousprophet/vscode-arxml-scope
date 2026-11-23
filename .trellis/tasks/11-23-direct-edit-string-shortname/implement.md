# Implementation plan — Ctrl+S-only ECUC editing

## Phase 0 — Red loop and regression evidence

- [x] Start the preview server and open `editor-syntax`.
- [x] Reproduce the quote multiplication before the adapter split.
- [x] Reproduce the Details focus loss: after an ack/patch, the focused input is detached and
      `document.activeElement` becomes `BODY`.
- [x] Record the path-id churn: a rename changes the container id, and the next edit still
      carries the old id.
- [x] Root cause confirmed by the user; commit model approved: **Ctrl+S only**.

## Phase 1 — Pure display/raw contract

- [ ] Move `displayForRaw` into `src/webview/monaco/synthetic.ts`; export it.
- [ ] Keep quotes outside `fieldSpans.value`; `span.text` is the raw value.
- [ ] Remove `rawFieldText` and all callers; pass raw span text directly.
- [ ] Change `applyLocalField(nodeId, field, raw)` to compute display once.
- [ ] Change `replaceSyntheticLine(line, row, field, raw, display)`:
  - [ ] parameter value → `{ value: raw, shownValue: display }`;
  - [ ] short name → `{ shortName: raw }`;
  - [ ] definition ref → `{ definitionRef: raw, label: lastShortName(raw) }`;
  - [ ] update `documentModel` line/span metadata;
  - [ ] skip `pushEditOperations` when the line text is already identical.
- [ ] Update `handleEdit` and `handleMultiChange` to pass span text as raw.
- [ ] Add tests in `src/test/webview/syntheticDocument.test.ts`:
  - [ ] textual span excludes the quotes;
  - [ ] numeric/boolean spans are bare;
  - [ ] empty string, embedded quotes and escaped newline display;
  - [ ] short-name span remains inside the quotes.

## Phase 2 — Ctrl+S-only local drafts

- [ ] Remove `EDIT_DEBOUNCE_MS`, `editTimer`, and every timer check.
- [ ] `queueEdit` stores `pendingEdits` only; no host write.
- [ ] Rename/document `QueuedEdit.display` as the span text; every queue passes raw span text.
- [ ] Remove the short-name staging parameter from `flushEdits`.
- [ ] `flushEdits` sends all pending edits:
  - [ ] non-short-name fields first;
  - [ ] short-name fields by descending `rowById.get(nodeId)?.level`;
  - [ ] stable order for equal levels.
- [ ] Add `pruneRedundantPending()` before a save flush: drop pending entries with no in-flight
      value that already equal the accepted field value.
- [ ] `requestSave`:
  - [ ] invalid → focus/reveal first invalid, no save;
  - [ ] prune, set `saveRequested`, flush all;
  - [ ] wait for pending/in-flight empty, then post `save`;
  - [ ] any refusal clears `saveRequested`.
- [ ] `handleEditResult` flushes remaining pending entries only when `saveRequested` or a host
      `flushEdits` request is outstanding.
- [ ] Remove flush-on-blur and flush-on-pagehide. Keep `beforeunload` warning.
- [ ] Host `flushEdits` request still flushes and acknowledges; no timer wait.
- [ ] Update `localEditPending`, `localDraftExists`, `maybeRequestSave`,
      `maybeAcknowledgeFlush` and `clearPendingEdits` for the removed timer.
- [ ] Add a pure test for the flush order (values first, deepest short name first).

## Phase 3 — Details is a view of the shared draft

- [ ] Add `localValueFor(nodeId, field)` in `editorMonaco` (invalid text first, then newest
      pending/in-flight raw value).
- [ ] `updateInspector` seeds editable controls from the shared draft.
- [ ] Extend the Details component:
  - [ ] `detailsValueInput(row, data, draft?)`;
  - [ ] `detailsContainerFields(row, data, draft?)`;
  - [ ] `detailsFieldInput(..., hostValue, draft?)`;
  - [ ] `detailsDraft` stores the host `original`, carries the previous refusal, and does not
        restore a stale previous input value.
- [ ] `syncDetailsField(nodeId, field, value, error?)` updates value/caret and sets/clears the
      inline error even when the text is unchanged.
- [ ] `applyLocalField` passes the local error to `syncDetailsField`.
- [ ] Preserve focus/caret across `updateInspector`:
  - [ ] remember `data-field`, `data-node-id`, selection start/end;
  - [ ] restore on the same row+field;
  - [ ] fall back to the host-selected row when the old id disappeared (rename).
- [ ] Keep Details drafts available after a selection change; `detailsSelectionChanged` only
      clears the old DOM bindings.
- [ ] Update `src/test/webview/components/detailsEditor.test.ts`:
  - [ ] draft seeds the control; Escape restores the host value;
  - [ ] selection change does not discard the shared draft;
  - [ ] inline error is restored from the draft;
  - [ ] Enter still does not commit.
- [ ] Add `selection`/focus coverage in the editor page preview if feasible.

## Phase 4 — Preview audit and manual regression loop

- [ ] Update `previewAudit.ts`:
  - [ ] `editor-dirty` expects zero host edits while typing and a visible dirty marker;
  - [ ] `editor-invalid` still expects zero edits and no save;
  - [ ] add a Details typing state (or extend an existing editor state) that:
    - [ ] selects a textual parameter,
    - [ ] types in `#details-value`,
    - [ ] asserts the editor line, focus and caret,
    - [ ] asserts no host edit before Ctrl+S.
- [ ] Manual browser loop, recorded in the task notes:
  - [ ] string: type, backspace, Delete, Ctrl+Backspace, select-and-replace, clear, retype;
  - [ ] numeric: valid/invalid intermediates (`-`, `0x`, `1.`), backspace, empty, retype;
  - [ ] boolean: partial `tru`, complete `true`, select/typing false;
  - [ ] short name: full `BranchX123456`, backspace, select-and-replace, Ctrl+S;
  - [ ] definition ref: type, backspace, Escape;
  - [ ] Details: type/backspace, focus stays, next keystroke lands, save;
  - [ ] multiple rows: edit two fields, select another row, Ctrl+S saves both;
  - [ ] rename + value in the same container: value applies before the rename;
  - [ ] nested rename: child first, then parent, no stale id.
- [ ] Confirm zero `edit` messages before Ctrl+S in every case.
- [ ] Confirm one coalesced edit per field on Ctrl+S, then `save` after acks.

## Phase 5 — Verification

- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] Focused tests:
  - [ ] `npm test -- syntheticDocument`
  - [ ] `npm test -- detailsEditor`
  - [ ] `npm test -- editing`
- [ ] `npm test`
- [ ] `npm run shots:webview`
- [ ] `node esbuild.js --production`
- [ ] `git diff --check`

## Review gates

- [ ] Quotes are never duplicated by display/raw conversion.
- [ ] Typing never posts a host edit.
- [ ] Details focus/caret survives every local repaint and host echo.
- [ ] A short-name rename sends the final value only and keeps the node selected.
- [ ] Multi-field and nested renames flush in a safe order.
- [ ] Invalid drafts stay editable and block Ctrl+S; correction unblocks it.
- [ ] Details/direct draft, dirty, Escape and guarded Ctrl+S remain intact.
- [ ] No debounce timer or flush-on-blur/pagehide remains.
- [ ] Temporary instrumentation is removed.

## Result

Implemented and verified on 2026-11-23.

- Ctrl+S-only commit model; no debounce, blur or page-hide write.
- One shared draft across Monaco and Details, surviving row/field switches.
- Display/raw split with quotes outside the value span; no double wrapping.
- Durable rename intents, early-ack remap, deepest-first nested resolution, and a second
  Ctrl+S deferred until the renamed rows arrive.
- Details focus/caret preserved across inspector rebuilds and host echoes.
- Local undo/redo uses the model stack while a draft exists; host undo only with no draft.
- Local validation aligned with the host for Integer, Float, Boolean, short name and
  definition reference grammar.
- Verification: 961 tests passing; 25 preview states with zero audit violations;
  `check-types`, `lint`, `git diff --check`, `node esbuild.js --production` passing.
- Manual browser loops: string type/backspace/word-delete/replace/clear/retype; numeric
  invalid-to-corrected save; Details typing with host echo; direct and Details short-name
  rename with post-flush keystrokes and a second Ctrl+S; multi-row save; local undo.
- Automated-only coverage (no manual browser pass): boolean partial/mid-edit, definition-ref
  typing/Escape, nested rename end-to-end; covered by the validation, flush-order, rename
  intent and host tests.

## Rollback

- [ ] Revert the adapter/commit-boundary fix only; no persisted format or protocol migration.
