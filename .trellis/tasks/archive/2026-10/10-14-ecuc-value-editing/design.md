# Design: ECUC value editing in the custom editor

Implements `../10-14-ecuc-artext-editor/design.md` §8 (write-back and validation) and the document
half of §9 (lifecycle). Read those first; this file records only what this child must decide itself.

## 1. Document model

There is no custom document class to write. `CustomTextEditorProvider` has no `openCustomDocument`,
so VS Code hands `resolveCustomTextEditor` the **real `TextDocument`** and that is what every write
targets. The provider keeps only per-panel state: the current model, **derived by re-scanning**, and
nothing cached across a change. Re-scanning rather than caching is what keeps a stale range from ever
being written to the wrong bytes.

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
unrepresentable in XML, or if it is unchanged; `workspace.applyEdit` **one** `WorkspaceEdit` that
replaces the recomputed region with the escaped text; on success re-scan and push the new model to the
webview. There is no event to fire — see §2.4. Refusals post a `notice` and mutate nothing.

**2.4 Undo and redo are not ours to implement.** `CustomTextEditorProvider` has no
`onDidChangeCustomDocument` and no `undo()`/`redo()` callbacks, and it must not be given any: the
writes go through `WorkspaceEdit` onto the real `TextDocument`, so the text document's own history
applies and one user action is one undo step for free. This replaced the invertible-edit-event design
that the first draft specified — see the parent's `research/spike-results.md` §Spike A. Do not add a
private history, and do not convert the provider to `CustomEditorProvider` to get callbacks it does
not need.

**2.5 Validation before mutation.** The validator is the core child's function, so a refusal costs no
partial write: either the whole replacement is applied or nothing is. This ordering is what AC6
measures, and it is the reason validation lives in core and not in the message handler.

**2.6 Lifecycle is the platform's.**

There is nothing to implement here. `CustomTextEditorProvider` has no `saveCustomDocument`,
`saveCustomDocumentAs` or `revertCustomDocument` hook, so the extension does not provide them; save,
save-as and revert are the ordinary text-document operations, and dirty state is VS Code's own
tracking. This is the direct consequence of D10's choice to edit the real `TextDocument` rather than
carry an in-memory value, and it is why the first draft of this section — which described delegating
those hooks — was wrong and has been removed. Verify the behaviour (§`prd.md` AC5) rather than
implementing a mechanism: a revert must reload from disk and the view must refresh through the
re-scan subscription.

**2.7 One edit, one undo step.** A single user action produces exactly one `WorkspaceEdit`, so Ctrl+Z
returns to the previous state in one keystroke, matching any other editor. Nothing has to cooperate
with the history: the text document records the edit because the edit is real.

## 3. Risks

- **Offset replay** (the naive implementation) writes to the wrong bytes as soon as a value changes
  length. §2.2 is the mitigation, and the byte-comparison test asserts it rather than trusting it.
- **Shape-2 fidelity.** `<VALUE/>` must round-trip. §2.1's verbatim `oldText` is the mitigation.
- **Undo granularity** (§2.4, §2.7) — if a single action ever becomes two `WorkspaceEdit`s, undo needs
  two presses per edit. One edit, one `WorkspaceEdit`; there is no event to double-fire.
- **Revert and save-as are platform behaviour, not ours** (§2.6) — verify the behaviour in Spike A rather
  than assuming it; there is no hook to implement if it misbehaves.
- **Refusal must not half-write.** Validation runs before `applyEdit`; there is no repair path if that
  ordering is inverted.
