# Diff row keys — what the port must reproduce

Facts gathered from `src/core/diff/diffModel.ts` before writing any Rust.

## Keys are ids, not a separate scheme

- A **paired** row's key is the left row's id: `key: left.row.id` (`pairedNode`).
- A **removed** row keeps its left id.
- An **added** row is `ADDED_KEY_PREFIX + <right row id>`.
- `parentKey` is the parent row's key, so it follows the same rule one level up.

Consequence: key parity is *id parity plus pairing parity*. The engine already produces the
same ids as the TypeScript scanner (`parity:rows` is 66/66), so the port does not invent a
second key scheme — it must only reproduce which rows pair and which side owns a one-sided
row. That moves the risk from "reimplement keys" to "reimplement pairing".

## `baseKey` is the ordinal-free id

`baseKey(id)` removes every `#<ordinal>` occurrence, including a parent ordinal embedded in
a child id (`container:C#0/param:P#0` → `container:C/param:P`). Identity pairing is done on
that key inside a parent, which is why reordering does not rename anything.

## Where the port must be exact

- pairing decisions (identity first, semantic second),
- which side owns a one-sided row (`added` vs `removed`),
- `ADDED_KEY_PREFIX` and the key of a row built from a side node,
- `parentKey`, and the counters computed while flattening.

## What is *not* a key concern

- `meta`, `comments`, `changes`, word segments: values, compared by the parity harness.
- Header/summary/labels: compared too, but they do not feed the page's identity.

## Next reads

- `identity pairing` (`pairByKey`, `baseKey`) and the duplicate-ordinal rule.
- `childKey`/`candidateKey` in the semantic pass (substitutions).
- the added/removed side-node construction (`sideNode`, `pushSideNodes`), which decides the
  prefixed key and the placeholder cell.

## Identity pairing (strict mode) — the rules M1 must reproduce

- `baseId(id)` removes every `#<n>` that is followed by `/` or the end:
  `container:C#0/param:P#0` → `container:C/param:P`.
- `relativeId(id)` keeps the last `/` segment; used when pairing inside a parent the
  matcher has already renamed (the left/right segment then carries the rename).
- Children are grouped by `baseId(id)` (or `baseId(relativeId(id))`) **within one parent**,
  so a reordered duplicate still lands in the same bucket.
- Buckets are paired in three quality tiers:
  1. **content identity** — `kind, definitionRef, DEST, value, target, context,
     variant, condition` joined with `\u0000`; annotation meta is ignored.
  2. **subtree identity** — content identity plus the ordered children's subtree
     identities (`\u0001`/`\u0002` separators), so a reordered duplicate pairs with its
     identical twin.
  3. **sort identity fallback** — parameters by value, references by target+context,
     modules/containers by definitionRef+variant. This is what keeps a duplicate whose
     value changed one changed row instead of remove+add.
- Leftovers in a bucket pair via `singletonRight` (one left, one right) or a positional
  fallback before becoming `added`/`removed`.
- `treeOf` rebuilds the pre-order rows into a tree using each row's `subtreeSize`, and is
  defensive about a malformed size.

## Flattening and keys

- Paired row key = left row id; removed row key = left id; added row key =
  `ADDED_KEY_PREFIX + right id` (`ADDED_KEY_PREFIX` in `diffModel.ts`).
- `parentKey` is the parent row's key; `posinset`/`setsize` are sibling positions and
  `subtreeSize` the contiguous display span, recomputed over the merged tree.
- Header rows, the header gap and the module gap are page rows, not diff keys.

## Recorded baselines (2026-11-14, this machine)

| Benchmark | Record |
|---|---|
| `diffSemantic` | 6 022 rows / 1 500 pairs → 62 ms, 3 MiB |
| `diffSemantic` (embedded names) | 4 400 rows / 200 pairs → 35 ms, 2 MiB |
| `renameScale` (500 renames) | 26 002 rows → 182 ms, 10 MiB |
| `renameScale` (700 renames) | 36 402 rows → 84 ms, 14 MiB |
| `diffToggle` | semantic first 52 ms, strict first 10 ms, cached 0 ms |

The port must stay under these ceilings and keep `diffToggle`'s cache behaviour.

## Strict parity result (M1, 2026-11-14)

`npm run parity:diff` compares whole strict documents from the Rust CLI with the bundled
TypeScript oracle: 41/41 pairs, every fixture against itself plus seven edited pairs.

Two defects the run exposed, both fixed rather than exempted:

- The first draft built one tree (of the left rows) and looked up right-side nodes in it,
  so every comparison was left-against-left.
- `finish` recorded node ranges as scanner byte offsets. Every other range is UTF-16, so a
  non-ASCII character before the element shifted `range.start` by one per extra byte.
  `SourceText::utf16_at_byte` now converts at the one place node ranges are written.

## Semantic parity result (M2, 2026-11-14)

`npm run parity:diff` now runs three modes over the same pairs: strict, semantic, and
semantic with `--budget 1`. 159/159 checks match: full documents, `match` blocks,
`substitutions`, `renameImplied`, counters and the limit reason.

The original fixture set never reached the semantic pass — every container paired
strictly — so M2 added `src/test/fixtures/semantic/`:

| Pair | What it proves |
|---|---|
| `rename.left/right` | two containers pair, `NMH→NM` is learned and implied in the change |
| `embed.left/right` | 20 of 25 children embed the old name; same pairing without children signals |
| `empty.left/right` | childless containers pair on the empty-child score |
| `large.left/right` | 600 x 600 under one definition is above the pair limit, so the fallback pairs all 600 with `fallback: true` |
| `embed` at budget 1 | `semanticSkipped: 8`, `semanticLimitReason: "budget"` |

Floating-point parity relies on writing the score expression in the TypeScript order;
both languages use binary64, so equal order gives equal bits. Tie-breaks use `str::cmp`
where the oracle uses `localeCompare`; no fixture has hit a tie that needs ICU collation,
and if one does the oracle itself would be locale-dependent on the machine running it.
