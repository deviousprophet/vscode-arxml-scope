# Rename matching — technical design

## Why the current matcher fails

`child_key` is

```
kind | definition-ref | sort_identity(value or target)
```

For a parameter, `sort_identity` is its value. Benchmark containers carry child
values like `NMH_MO_0_V_3`. After a rename the value becomes `NM_MO_0_V_3`, so the
child multiset differs, `children_score` is 0, and `score_semantic_node` refuses the
pair before the name score matters. Wholly different tokens also miss the
signature/token candidate groups. When no candidate exists at all, position cannot
help either.

## Change 1 — mask the container's own name

In `semantic_nodes` (Rust) and `semanticNodes` (TypeScript):

```ts
const self = nameOf(node);
for (const child of node.children) {
  childKeys.set(childKey(child, substitutions, self), …)
}
```

`childKey` gains `selfName` and replaces every exact occurrence of `selfName` in the
`sort_identity` text before applying substitutions:

```ts
function maskSelf(text: string, selfName: string): string {
  return selfName === '' ? text : text.split(selfName).join('<self>');
}
```

`childBlob` gets the same treatment for substitution learning and reason strings.
`substituted` (the container's own name) is not masked.

Both sides use the same placeholder, so `NMH_MO_0_V_3` and `NM_MO_0_V_3` both become
`<self>_V_3`, and the child multiset matches.

## Change 2 — content-keyed candidates

`collect_semantic_candidates` already has a `child_key_signature` group. With the
masked key it becomes the position-independent block for renames: containers whose
children differ only by the parent name share one signature regardless of where they
sort. The existing rare-token group covers containers with few or no children. Keep
the group order:

1. masked child-key signature (strongest);
2. name signature (digit-collapsed);
3. rare tokens;
4. position neighbours, only to seed the near-tie margin.

No new candidate key is needed once the signature is masked; adding name tokens to
the content key would break the wholly-different-token case. Document this in the
comment so a future edit does not "fix" it back.

## Safety

- `accepted_candidate` still requires the best score, a margin over the second, and
  the score floor. Unrelated values give `children_score == 0`, so zero pairs.
- `DEFINITION-REF` bucketing happens before candidate generation; masking never
  crosses a bucket.
- Ties remain unpaired because `compare_semantic_pairs` keeps the deterministic
  order and `greedy_pairs` refuses equal-score ambiguity the same way.

## Tests

Rust `diff.rs` unit tests build rows directly (`container`, `parameter` helpers).
Add a matrix generator `renamed_children(prefix, count, value_prefix)` that mirrors
`renameScaleBenchmark.ts`, then assert `summary.renamed`, `added`, `removed`.

TypeScript `diffModel.test.ts` gets the same matrix through the existing `arxml`
helpers. `parity:diff` compares both implementations on the fixture corpus; add a
fixture pair under `src/test/fixtures/semantic/` for wholly different tokens and for
new containers sorting before.

## Performance

Masking is one `split/join` per child cell, so it is linear in child text and only on
the semantic path. Benchmark guard stays 3 s for 500 and 6 s for 700.
