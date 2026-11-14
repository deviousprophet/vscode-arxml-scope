# Design — diff engine port

## 1. Shape

```
arxml-core/src/diff/
  model.rs      DiffRow/DiffCell/status/changes/match/header/summary (serde camelCase)
  identity.rs   row keys, ordinal-free base ids, duplicate pairing
  match.rs      container/module pairing: identity pass + semantic scoring + budget/fallback
  word.rs       word-level segments for a changed row
  document.rs   build the merged tree, assign keys/counters/labels, flatten
  patch.rs      copy-patch: a contiguous row replacement, or `unpatchable`
arxml-engine    diff.compute (streamed), diff.patch
```

`arxml-core` stays dependency-free of Node/VSCode; `serde` only. The host keeps the page,
selection and protocol.

## 2. Data contract

`DiffDocument` is serialized exactly as today (`core/diff/diffModel.ts`), because the page's
row primitives and keys are its identity. The port must match, not redesign:

- `key` — the page's opaque identity for selection, collapse, search and reveal. The TS key
  derivation is the spec; the parity harness compares keys literally.
- `left/right` cells with `range`, `meta`, `comments`, `changes`, `match`.
- `posinset`/`setsize`/`subtreeSize`, `level`, `parentKey`, `hasChildren`.
- `summary`, `labels`, `leftHeader`/`rightHeader`, `semanticSkipped`, `semanticLimitReason`.

## 3. Pairing algorithm

Two passes, in the TS order:

1. **Identity**: pair by the ordinal-free base key inside each parent (duplicate ordinals
   make siblings distinct; the base key removes the ordinal). Stable, document-order.
2. **Semantic**: for remaining container/module candidates, score child/name/position
   similarity, learn token substitutions, accept above the threshold, with the pair budget
   and the above-limit fallback. The score is the TS score; if f64 ordering can differ,
   the implementation must use the same comparison order and tie-break (position, then
   key) and the harness will prove it.

Unmatched rows become `added` (right only) or `removed` (left only), with side nodes built
bottom-up exactly as the TS does.

## 4. Keys and counters

Keys are assigned while flattening the merged tree; `subtreeSize` counts the contiguous
display rows, `posinset`/`setsize` count siblings. These are recomputed, never patched,
when a full build runs. The patch path may only patch them when it can prove the local
recomputation equals the build (see §6).

## 5. Protocol

```text
diff.compute { left:{uri,text?}, right:{uri,text?}, options:{semantic} }
  → streamed chunks: { chunk:{seq,last,total}, rows:[...] }, final header/summary frame
diff.patch   { leftDoc, rightDoc, op, targetRange, sourceRange, side }
  → { ok:true, patch:{at,remove,rows} } | { ok:false, code:'unpatchable', reason }
```

Text is uploaded once per document (`doc.open` already exists); `diff.compute` takes two
doc ids rather than text so the engine reuses its model and rows.

## 6. Patch contract

`diff.patch` receives the copy the host applied (side, ranges, new text) and returns the
diff rows that changed. It must equal a full rebuild after the same edit. Implementation
strategy: rebuild the affected subtree (the copied element's parent chain) and re-pair only
that parent's children; splice the resulting sibling span into the existing row list and
adjust ancestor counters. `unpatchable` when:

- a module row changed (top-level order/labels),
- the parent's duplicate ordinals shift,
- the parent is unmatched or was created,
- the engine's text does not match the range the host reports.

## 7. Host integration

`DiffPanel` builds a `DiffSession` from the engine instead of `buildDiffDocument`; the
`DiffDocument` shape is unchanged, so the page is untouched. The TypeScript diff stays
under `src/test` as the oracle. The panel's refresh path asks for a new `diff.compute`; a
copy asks for `diff.patch`.

## 8. Parity harness

New `src/test/core/diffParity.test.ts`:

- serialize the TS oracle and the engine output canonically (sorted keys, fixed number
  formatting) and compare byte-for-byte;
- every fixture, strict and semantic, plus one generated 2 MiB document;
- compare keys, statuses, word segments, headers, summary and limit codes;
- a second suite feeds the same fixture pair through `diff.patch` after each copy of a
  fixture scenario and asserts `patched === rebuild`.

The CLI gains `diff --json --strict|--semantic` for shell-level parity, mirroring
`arxml-cli rows`.

## 9. Performance and risks

- Full diff on the 26 MiB pair stays inside the `diffSemantic`/`renameScale` ceilings; the
  patch is under 50 ms at 20 MiB.
- **Floats**: semantic scores are f64. Keep the TS comparison order and tie-breaks; if
  parity fails on a tie, make scores integral or compare with an epsilon in the same place
  both sides do — never silently round.
- **Keys**: the key scheme embeds pairing decisions; a single mismatch invalidates the
  page's state. Parity is the gate, no exemptions.
- **Budget**: the semantic pair limit must count the same candidates in the same order or
  `semanticSkipped`/`semanticLimitReason` diverge.

## 10. Rollback

The port lands unused first (modules + parity + CLI), then one commit switches
`DiffPanel` to the engine. Reverting that commit restores the TypeScript diff without
touching the copy UI's protocol.
