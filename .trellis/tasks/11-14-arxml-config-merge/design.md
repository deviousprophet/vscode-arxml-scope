# Design — two-way copy merge in the diff view

## 1. What this replaces

The previous three-way design is dropped. Removed with it:

| Piece | Fate |
|---|---|
| `core/merge/plan.ts` (matrix, conflicts) | delete |
| `core/merge/model.ts` (conflict model) | delete; keep a small `MergeRow` type if needed |
| `host/merge/mergeCommand.ts`, `mergeController.ts` | delete |
| `webview/components/mergeBar/**`, `merge`/`mergeResolve`/`mergeWrite` protocol | delete |
| engine `doc.mergeIndex`, `arxml-cli merge-index`, `merge.rs` | delete (diff cells already carry ranges) |
| `docs/MERGE.md` | rewrite for copy merge |
| `core/merge/compose.ts`, `lines.ts` | **keep** — element splice, line delete, re-indent are exactly what a copy needs |
| changelog entry | rewrite |
| 3-way tests + merge benchmark | replace with copy tests + a copy benchmark |

The branch keeps the merge history: a revert commit removes the parts above and the
rewrite lands on top, so the decision is auditable.

## 2. Read-only boundary

The diff is read-only until merge mode is on. Merge mode is a per-panel boolean in the
host session, toggled from the toolbar; the page hides every copy affordance when it is
off. The host refuses `copy` messages in read-only mode — the page is not trusted to be
the only guard.

## 3. The copy operation

A copy is expressed against the **displayed** panes. The page posts
`{ type: 'copy', side: 'left' | 'right', key }`, where `side` is the displayed side the
arrow belongs to and `key` is the diff row key. The host maps the displayed side to the
host side (`hostSide`, the same rule reveal uses), so Swap can never copy into the wrong
file.

For one row, with `source` = the clicked side's cell and `target` = the other side's cell:

| Source | Target | Action |
|---|---|---|
| present | present | replace the target element span with the source element bytes, re-indented |
| present | absent | insert the source element under the matched target parent |
| absent | present | delete the target element with its line span |

The unit is the whole element; a container carries its subtree. Replacing a container
therefore removes target-only children — that is the meaning of "make this side match".

## 4. Missing parents

The target parent for an insert is the row's parent pairing. When the chain is missing:

- synthesize each missing ancestor as a **minimal container**: its own `SHORT-NAME`,
  `DEFINITION-REF` (+`DEST`), own condition/annotations, and one child list holding only
  the copied chain. Copying the source ancestor verbatim would drag its unrelated children
  into the target.
- insert the outermost created ancestor at the position of its nearest matched sibling.
- refuse when the missing chain would need a **module**: creating a module picks an
  `AR-PACKAGE` and a module definition, which is a different feature.

> Review point: the user asked for "always create the parent". Minimal synthesis is the
> only interpretation that does not import unrelated siblings; confirm before M2.

## 5. Applying to documents

One copy is one `WorkspaceEdit` on the target `TextDocument`:

- replace/insert/delete are computed as text spans against the target text, using the
  same element spans and line-span rules as the editor's write path;
- the target becomes dirty; `Ctrl+Z` in that pane is VS Code's undo;
- the source document is untouched, so `Ctrl+Z` in the source pane does nothing (correct:
  the source was not edited);
- the pane label shows `•` while the document is dirty (from `document.isDirty`, updated
  on save).

## 6. Stale snapshot

The panel's diff is a snapshot. Before applying, the host verifies:
`targetText.slice(target.range) === target.expected` and the source span still holds the
element the row showed. On mismatch: post nothing, show a modal **Reload / Cancel**.
Reload rebuilds the comparison from the **current in-editor documents** (not from disk —
that would discard unsaved copies).

## 7. Engine boundary

Child `11-14-diff-engine-port` moves the diff into Rust and adds a copy-patch operation:

```text
diff.compute  { leftDoc, rightDoc, options }  → streamed DiffDocument
doc.copy      { docId, op: replace|insert|delete, targetRange, sourceRange }
              → { patch: { at, remove, rows }, ok } | { ok: false, code: 'unpatchable', reason }
```

The patch is a contiguous replacement in the **diff row list**, the same shape the editor
already applies for `documentPatch`, so the page splices its display rows. Word-diff marks
for the patched row come down with it.

Until the port lands, the host computes the patch from the TypeScript diff; the copy UI
must not depend on a full rebuild either way.

## 8. Patch correctness and fallback

The patched diff must be observably identical to a full rebuild: same row keys, order,
statuses, `posinset`/`setsize`/`subtreeSize`, word marks, headers and summary.

- Replace: one row, no re-index.
- Insert/delete: the affected sibling span plus ancestor counters.
- Unpatchable, always a debounced rebuild with a notice: (a) module change, (b) a copy
  that shifts duplicate-container ordinals, (c) an unmatched or created parent, (d) stale
  bytes.
- The gate is a property test: random copy sequences over the fixtures and a generated
  document, asserting `patched === fullRebuild` on the serialized document.

## 9. Performance contract

20 MiB pair, warm engine: arrow click → row visibly changed < 100 ms; comparison
consistent < 250 ms via the patch; 10 copies / 10 s with at most one patch in flight; no
copy triggers a synchronous full diff on the extension host.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Replacing a container deletes target-only children unexpectedly | the row tooltip states the replace; one undo restores; the PRD makes it explicit |
| Minimal ancestor synthesis diverges from what the user expects | review point in §4 before M2; property tests assert the resulting tree |
| Diff patch drifts from a full rebuild | exact equality test over random sequences, plus a rebuild fallback for the four cases |
| The diff port changes the page's row contract | parity gate: serialized `DiffDocument` equal to the TS oracle, keys included |
| Two dirty documents confuse save/close | the `•` marker and VS Code's own dirty prompts; no custom save path |

## 11. Rollout

1. Revert the 3-way pieces (one commit).
2. Child `diff-engine-port` lands the engine diff behind exact parity; the panel switches
   to it in one commit that can be reverted to the TS diff.
3. Child `copy-merge-ui` adds the toggle, arrows, copy path, patch and fallback.
4. Docs/changelog/spec in the same child; the parent reviews the integration.

Each step is independently revertable; no file format or protocol of another feature
changes.
