# Design: ECUC value editing in the custom editor

Implements `../10-14-ecuc-artext-editor/design.md` §8 (write-back and validation) and the document
half of §9 (lifecycle). Read those first; this file records only what this child must decide itself.

## 1. Document model

The provider gains a `CustomDocument` per file. It is thin, because writes land on the **real**
`TextDocument`: the class holds the `uri` and the current model **derived by re-scanning**, and it is
the object the provider returns from `openCustomDocument` / `resolveCustomTextEditor`.

The model is never cached across a change. Every write, undo, redo and external edit invalidates it,
and the next question about a node re-scans. A cached model is the mechanism by which a stale range
would be written to the wrong bytes.

## 2. Decisions this child owns

**2.1 Regions, not offsets.** An edit record stores:

```
{ nodeId, region: 'value' | 'element', oldText, newText }
```

`region: 'value'` is the text content inside `<VALUE>…</VALUE>` (the common case);
`region: 'element'` is the whole `<VALUE/>` element, used only when it is empty or self-closing.
`oldText` and `newText` are the **exact strings** that occupied and will occupy that region.

`oldText` for the `'element'` region is the verbatim original element slice, not a reconstruction from
the value. That is what makes undo byte-exact for `<VALUE/>`: undoing reconstructs nothing, it puts
back the bytes that were read.

**2.2 Ranges are recomputed, offsets are never replayed.** A value's length changes when edited, so
every offset after it shifts and the stored range from edit time is wrong for the inverse edit. Undo
and redo therefore re-scan, resolve `nodeId`, recompute the region for the recorded region kind, and
replace. This is exactly why `nodeId` must be path-based and stable across a re-scan (sibling child
`../10-14-artext-custom-editor` §2.2) rather than an index.

**2.3 Applying an edit.** In order: re-scan and resolve the node; refuse if the node is gone or is not
a value-bearing node; validate the candidate with the core validator; refuse if invalid, if
unrepresentable in XML, or if it is unchanged; `workspace.applyEdit` a `WorkspaceEdit` that replaces
the recomputed region with the escaped text; on success record the edit and fire
`onDidChangeCustomDocument` with a `CustomDocumentEditEvent`; re-scan and push the new model to the
webview. Refusals post a `notice` and mutate nothing.

**2.4 Undo and redo do not re-fire.** The `undo()` and `redo()` callbacks apply their replacement and
return; they must not fire `onDidChangeCustomDocument` again, or the history double-counts. VS Code
owns the stack; the extension supplies the inverse operation and fires exactly once, when the edit is
first applied.

**2.5 Validation before mutation.** The validator is the core child's function, so a refusal costs no
partial write: either the whole replacement is applied or nothing is. This ordering is what AC6
measures, and it is the reason validation lives in core and not in the message handler.

**2.6 Lifecycle.**

- `saveCustomDocument` → the document is already the real text document, so this delegates to saving
  it. Dirty state is VS Code's own tracking, which is why D10 chose to edit the `TextDocument` rather
  than carry an in-memory value.
- `revertCustomDocument` → reload from disk via the workbench's revert command, then re-scan and push.
- `saveCustomDocumentAs` → save-as through the workbench and adopt the new `uri`.

Revert and save-as are implemented but flagged for verification with **Spike A**: they depend on
workbench commands rather than a document API, and that is exactly the kind of assumption a spike
exists to test.

**2.7 One edit, one undo step.** A single user action produces a single `WorkspaceEdit` and a single
event, so Ctrl+Z returns to the previous state in one keystroke, matching any other editor.

## 3. Risks

- **Offset replay** (the naive implementation) writes to the wrong bytes as soon as a value changes
  length. §2.2 is the mitigation, and the byte-comparison test asserts it rather than trusting it.
- **Shape-2 fidelity.** `<VALUE/>` must round-trip. §2.1's verbatim `oldText` is the mitigation.
- **Recursion while firing the change event** (§2.4) — a double-fired event produces an undo stack that
  needs two presses per edit.
- **Workbench-command dependence** for revert and save-as (§2.6) — verify in Spike A, do not assume.
- **Refusal must not half-write.** Validation runs before `applyEdit`; there is no repair path if that
  ordering is inverted.
