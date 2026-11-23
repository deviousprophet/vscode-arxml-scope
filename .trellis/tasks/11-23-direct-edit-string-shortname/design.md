# Design — Ctrl+S-only ECUC editing

## 1. Confirmed root cause

The regression is the shared draft's **continuous host write plus echo rebuild**, not the Rust
scanner and not Monaco's key handling.

### Details path

- Before `7fa13b6`, Details typed locally and committed one edit on Enter/Tab. No host write
  happened while typing, so no re-scan and no id change could interrupt the input.
- `7fa13b6` changed `input`/`change` to `detailsPreview` → `previewEdit` → `applyLocalField`,
  which queued a host write after 160 ms, and made Enter a no-op.
- Each accepted write made the host re-scan and post `documentPatch`/`document`; both call
  `updateInspector()`, which clears `detailsBody` and rebuilds the input.
- Browser repro: type one character in `#details-value`, then post the host ack/patch. The old
  input is detached and `document.activeElement` becomes `BODY`; the next keystroke is lost.

### Direct editor path

1. **Double display wrapping.** Before the shared draft, `handleEdit` only queued the host
   edit and left Monaco's typed text alone. `7fa13b6` routed the same change through
   `applyLocalField(raw, text)`, where `text` is already display text; `displayForRaw` wrapped
   it again. `Text = "hello"` plus `1` became `Text = ""hello1""`. The same wrong repaint
   affected backspace/delete because the line was rebuilt from the doubly-wrapped value.
2. **Path-id churn.** A container id embeds its short name. The first accepted rename prefix
   changed the id; `pendingEdits`/`inflightEdits`/`detailsEdits` still keyed on the old id. The
   next edit targeted the dead id, so the host refused with "the node is no longer in the
   file", and rebuilding without an overlay-able draft truncated the visible tail.

### Why both views failed together

Both wrote to the host on a typing pause and treated the echo as an authoritative document
replacement. The common root is the missing commit boundary plus path-based identity churn.

## 2. Approved commit model

**Ctrl+S is the only commit trigger.** Nothing is written to the host while the user types.

```text
Monaco change ─┐
Details input ─┼─> applyLocalField(nodeId, field, rawValue)
                │      ├─ validate locally
                │      ├─ repaint the synthetic line (raw inside the span, quotes outside)
                │      ├─ update the Details input + caret + inline error
                │      ├─ invalid -> invalidEdits, no host write
                │      └─ valid   -> pendingEdits (no timer, no host write)
                │
                └─> Ctrl+S
                      ├─ refuse when invalidEdits is non-empty
                      ├─ flush one coalesced edit per field, short names last/deepest-first
                      ├─ wait for every editResult
                      ├─ any refusal -> stop, keep the draft invalid
                      └─ all accepted -> post `save`
```

- Enter remains a no-op in Details.
- Blur, row selection and page hide never flush. `beforeunload` still warns when a local draft
  exists; it must not write.
- The host-initiated `flushEdits` handshake (source-tab save / `onWillSaveTextDocument`) is the
  one exception: it is an explicit save path and flushes the drafts so the host can save.
- The host protocol is unchanged: `edit`, `editResult`, `flushed`, `save`.

## 3. Local draft is the single source of truth

Keep the existing per-field maps; they are now the only draft:

- `pendingEdits: Map<fieldKey, QueuedEdit>`
- `inflightEdits: Map<editId, QueuedEdit>`
- `invalidEdits: Map<fieldKey, InvalidEdit>`

Rules:

- `fieldKey = nodeId|field`.
- One entry per field; a new keystroke replaces the previous pending value.
- `QueuedEdit.value` is the raw host value. `QueuedEdit.display` is renamed/redefined as the
  **span text** (raw inside the value span); `overlayLocalOnLine` inserts it between the span
  boundaries.
- `newestLocalEdit(key)` returns the pending or in-flight value. `localValueFor(key)` returns
  the invalid text when present, else the newest raw value.
- Details inputs are **seeded from `localValueFor`** when the inspector is (re)built. They are
  views of the shared draft, not a second draft.
- A selection change clears only the Details DOM bindings; the draft remains in the shared map
  and reappears when the row is selected again.
- `isRedundantEdit` still drops a draft that equals the host-accepted value, so a no-op is never
  sent at save time. Before flushing, prune pending edits that have no in-flight value and
  equal the accepted value.

## 4. Display/raw contract

Move `displayForRaw` into `monaco/synthetic.ts` and make the contract one-way:

- `displayForRaw(row, field, raw)` returns the complete line fragment:
  - textual parameter: `"` + raw (newlines escaped as `\\n`) + `"`;
  - numeric/boolean parameter: raw;
  - any other field: raw.
- `syntheticRowLine` keeps the quotes **outside** `fieldSpans.value`; the span text is the raw
  value. This is already in the working tree and must stay.
- `applyLocalField(nodeId, field, raw)` takes raw only. It computes `display` once and calls
  `replaceSyntheticLine(line, row, field, raw, display)`.
- `replaceSyntheticLine` builds the patched row directly:
  - parameter value: `{ value: raw, shownValue: display }`;
  - container short name: `{ shortName: raw }`;
  - definition ref: `{ definitionRef: raw, label: lastShortName(raw) }`.
  It must not call `rawFieldText` or otherwise re-parse display text.
- `handleEdit` / `handleMultiChange` pass the span text as raw directly.
- `rawFieldText` is removed (no callers).
- If the rebuilt line text equals the current Monaco line, `replaceSyntheticLine` updates the
  synthetic line/span metadata **without** `pushEditOperations`. This keeps direct typing a
  pure Monaco edit, avoids double undo entries and protects IME composition.
- Quotes are syntax, not content: deleting a quote is outside the span, so the line is restored.
  Deleting/inserting inside the span works, including an empty value.

## 5. Details focus, caret and errors

- `updateInspector` must preserve focus across a rebuild:
  - remember the focused details control's `data-field`, `data-node-id`, `selectionStart` and
    `selectionEnd`;
  - after rendering, restore focus/selection when the same row+field exists;
  - if the row id disappeared because a short-name rename changed it, restore on the host's
    selected row (the predicted new id).
- `updateInspector` seeds each editable control from the shared draft:
  - `detailsValueInput(row, data, draft?)`;
  - `detailsContainerFields(row, data, draft?)`;
  - `detailsFieldInput(row, field, label, hostValue, draft?)`.
  `original` is always the host-accepted value so Escape restores it; the input's initial value
  is the draft when one exists.
- `detailsDraft` no longer restores a previous input value from a stale control. It stores the
  host `original`, carries a previous refusal marker if the same row/field is still invalid, and
  wires the listeners.
- `syncDetailsField(nodeId, field, value, error?)` updates the input in place and preserves the
  caret; it sets or clears the inline error. If the input already holds the value, it still
  updates the error state.
- Invalid drafts are seeded back into the input with the same text and inline error after any
  rebuild.
- Details and direct editing therefore share one draft even when the user selects a different
  row before saving.

## 6. Flush order and short names

`flushEdits()` sends all pending edits in this order:

1. non-short-name fields (`value`, `definitionRef`) in insertion order;
2. short-name edits by descending row `level` (deepest container first);
3. stable insertion order for equal levels.

Why:

- A value edit under a container must be applied with the container's pre-rename id.
- A child container's id embeds its parent's short name, so renaming the child before the parent
  keeps the child's id valid.
- Renaming only at Ctrl+S means no intermediate prefixes ever reach the host, so the host's
  `nextNodeId` prediction keeps the final container selected.

A short-name write is recorded as a **durable rename intent** when it is posted. The host may
answer `editResult` before its re-scan, so the intent must outlive `inflightEdits`. The next
`document`/`documentPatch` resolves the intent against the new row store:

- the old row is still present -> keep deferring;
- the old row is gone and the predicted container exists (kind and short name match) -> re-key
  pending/invalid drafts and the Details caret from the old id to the new id;
- the old row is gone with no match -> drop the intent.

Resolve nested intents to a fixed point and apply deepest-first so a child draft lands on its
official new id before a parent prefix rewrite. If `saveRequested` or a host `flushEdits` request
is still outstanding after the rebuild, flush the remapped drafts and let the save proceed.
Never send a draft at an id the current row store no longer has. Never prune in-flight edits:
during a save a rename document can legitimately arrive before its `editResult`.

## 7. Save, dirty and errors

- `requestSave()` (Ctrl+S capture listener):
  1. if `invalidEdits` is non-empty: focus/reveal the first invalid field, keep the reason
     visible, do not save;
  2. set `saveRequested = true`, prune redundant pending edits, flush all;
  3. when `pendingEdits` and `inflightEdits` are empty, post `save`;
  4. any refusal clears `saveRequested` and keeps the refused text marked invalid.
- `updateDirtyStatus()` uses the local pending/in-flight/invalid state plus `hostDirty`; remove
  the debounce timer from every dirty/pending check.
- On a successful edit result, flush remaining pending entries only while `saveRequested` or a
  host `flushEdits` request is outstanding. Otherwise they are new local drafts and must wait
  for the next Ctrl+S.
- `maybeAcknowledgeFlush()` acknowledges only when pending/in-flight are empty; it no longer
  waits for a timer.
- The host `flushEdits` request calls `flushEdits()` and follows the same ack path.

## 8. Undo, redo and Escape

- With a local draft, Ctrl+Z/Ctrl+Shift+Z stay in Monaco's local undo stack and flow through
  `handleEdit` → `applyLocalField`. Undoing back to the host value drops the pending edit.
- A `localUndoActive` marker keeps local redo available after that drop, so redo can restore the
  undone draft from the model stack; a new edit, Ctrl+S or a host refresh clears it.
- With no local draft and no active local undo, undo/redo go to the host as before.
- The custom `undo`/`redo` actions and the Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y commands use the model stack
  directly; `editor.trigger('undo')` is not used because the custom action id shadows the
  built-in command.
- Escape in Details restores the host `original`, previews it locally and drops the pending edit
  when it equals the accepted value.
- No host write happens for undo/redo/escape until Ctrl+S.

## 9. Compatibility and tests

- No host protocol or persisted-format change. The host still applies one `WorkspaceEdit` per
  field and saves the real `TextDocument`.
- Pure tests:
  - `displayForRaw`: textual, numeric, boolean, empty string, embedded quotes, escaped newline;
  - synthetic spans: quotes outside the value span, raw span text, short-name span inside
    quotes;
  - flush ordering: values first, deepest short name first;
  - Details draft seeding: initial value from the draft, Escape restores the host value,
    inline error restoration, selection change keeps the draft available.
- Preview audit updates:
  - `editor-dirty` now expects **zero** host edits while typing and a visible dirty marker;
  - `editor-invalid` still expects zero edits and no save;
  - add an editor Details typing state if it can be done without forking production code;
    otherwise the browser loop in `implement.md` is the recorded proof.
- Manual browser probe (required evidence):
  - string value type/backspace/Delete/word-delete/replace, no edit before Ctrl+S;
  - Details type/backspace, focus retained, next keystroke lands;
  - short name full rename + Ctrl+S, one edit with the final value, no stale error;
  - numeric/float/boolean invalid intermediate states.

## 10. Rollback

Revert the adapter/commit-boundary change only. No persisted format, protocol or host migration
is involved. The previous debounced shared-draft behavior can be restored by reverting the
webview files and tests.
