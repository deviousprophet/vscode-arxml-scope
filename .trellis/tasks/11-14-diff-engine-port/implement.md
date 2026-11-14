# Implement — diff engine port

Ordered milestones; each ends at a gate. The port lands unused until M4, so only the
cutover commit can change the panel.

## M0 — Fixtures and baseline

- [ ] Record `diffSemantic`, `renameScale`, `diffToggle` and `ecucLargeFile` numbers.
- [ ] Add a generated ~2 MiB pair fixture builder for parity (deterministic, no random).
- [ ] Confirm the TS key derivation rules (`identity.ts`/`diffModel` helpers) and write
      them down in `research/keys.md`: ordinal-free base, duplicate handling, added/removed
      side keys, parent keys.

Validation: `npm run benchmark diffSemantic renameScale`.

Gate: the baseline and the key rules are recorded; no code yet.

## M1 — Strict diff and keys

- [x] `diff.rs`: rows, cells, statuses, changes, headers, summary, serde shape. Shipped as
      one module instead of `model.rs` + `identity.rs` + `document.rs`: the whole builder
      is ~450 lines and the split added no seam a later milestone uses.
- [x] Keys and ordinal-free identities (`base_id`, grouping, `right:` prefix).
- [x] Strict pairing (identity groups → exact id → ordinal-free fallback), side nodes,
      flatten with `posinset`/`setsize`/`subtreeSize`, counters, labels.
- [x] `arxml-cli diff --left … --right … [--semantic]`; semantic returns exit 1 until M2.
      The CLI prints JSON by default, so there is no `--json`/`--strict` pair to carry.
- [x] `scripts/parityDiff.mjs` (`npm run parity:diff`): bundles
      `src/test/parity/oracleDiff.ts` with esbuild and compares whole documents against
      the CLI. It stays a script, not a `vscode-test` suite, because it needs the built
      Rust binary and musl-less hosts cannot build one inside the extension test runner.
- [x] Rust unit tests in `diff.rs`: self-diff, tree positions, value change, added and
      removed sides, UTF-16 ranges.

Validation: `cargo test -p arxml-core`, `cargo clippy -D warnings`, `cargo fmt --check`,
`npm run engine:build`, `npm test` (parity), `npm run parity`.

Gate: byte-equal serialized documents, keys included, strict mode, zero exemptions.

Result: 41/41 pairs (every fixture against itself plus seven edited pairs), 14 Rust tests.
The parity run found two real bugs: one diffed both sides through the same tree, and the
scanner wrote node ranges as byte offsets while every other range is UTF-16.

## M2 — Semantic matching and budget

- [x] `diff.rs` semantic section: children/name/position/substitution score, accepted
      threshold and margin, candidate blocking, learned substitutions, name seeds,
      pair budget, oversized fallback, skip reason. Same module as M1 for the reason
      recorded there.
- [x] Parity covers `--semantic` and `--semantic --budget 1` for every pair, plus four
      new fixture pairs under `src/test/fixtures/semantic/`: a rename pair, embedded
      old names in 25 children, childless containers, and a 600 x 600 bucket that takes
      the above-limit fallback.

Validation: same as M1 plus `npm run benchmark renameScale`.

Gate: semantic parity exact; `semanticSkipped` and `semanticLimitReason` equal on the
limited fixtures; benchmark within the ceiling.

Result: 159/159 pairs match across strict, semantic and budget-limited runs. The four
fixtures exercise all three semantic outcomes: learned substitution (`NMH→NM` on two
containers), the empty-child score, and the oversized fallback (600 fallback pairs,
`fallback: true`). Budget 1 on the embed pair reports `semanticSkipped: 8` with
`semanticLimitReason: "budget"` on both sides, and a Rust unit test pins it.

## M3 — Word diff and streaming

- [x] `word.rs`: tokenisation, suffix-table LCS, segment merge — a port of
      `wordDiff.ts` with the same cases as its unit suite.
- [x] `diff.compute` streaming in row chunks with a final envelope frame (headers,
      summary, counters). Row frames never carry the last flag, so a client that
      resolves on the final chunk always has the envelope.
- [x] `npm run parity:words`: hand-written edges plus every changed field and cell
      field the fixture pairs produce, compared with the TypeScript `diffWords`.

Validation: parity + `npm test` (word suites), `cargo test`.

Gate: word-segment parity; a 26 MiB pair streams without a single oversized frame.

Word result: 44/44 pairs identical. The port reads characters, not UTF-16 code units:
splitting a surrogate pair the way JavaScript does would put a lone surrogate into a
JSON string, which Rust cannot encode. The only behavioural difference is a field
holding two lone surrogates, and the oracle cannot represent that either.

## M4 — Panel cutover

- [x] `DiffSession` is gone from production; `DiffPanel` opens both documents in the
      engine and requests `diff.compute`, on load, on refresh and on a mode switch.
- [x] The session moved to `src/test/core/diffSessionOracle.ts`; production `core/diff`
      imports are types and `compareTitle` only.
- [x] No page or protocol change: the page tests pass untouched (794 total).

Validation: `npm test` (all diff suites + page), `check-types`, `lint`, benchmarks.

Gate: the panel renders engine output; strict/semantic toggle, refresh, swap, search and
word marks behave as before.

## M5 — Copy patch

**Status (2026-11-14): blocked on a contract decision, not started.**

A first `patch_between` draft (sibling span + ancestor counters) failed its own equality
tests for a reason the design has to answer: every `DiffCell.range` is an absolute UTF-16
offset, so an edit shifts the ranges of *every node after it in the edited file*. Replacing
only the affected sibling span leaves later rows stale, and `patched === rebuild` fails on
the ranges alone.

The exact patch needs one more field: the applied edit's `at` and `by`. Rows outside the
span whose `range.start >= at` shift by `by`; nodes containing the edit are ancestors and
arrive as full rows. `diff.patch` therefore has to receive the copy the host applied
(`{start, end, text}`), not just the row key.

Baseline measured before the attempt (`npm run benchmark diffBenchmark`, 26 MiB pair,
73 884 rows): engine `diff.compute` 918 ms including 67 MiB of row JSON; host builder
370–444 ms plus 142–176 ms for the same JSON. A patch only wins if it stays in the
kilobytes, which the span + shift contract can do.

- [ ] `diff/patch.rs`: replace/insert/delete patch for one copy; ancestor counters; word
      marks for the patched row.
- [ ] `diff.patch` protocol in the engine and client.
- [ ] Property suite: random copy sequences over fixtures and the generated document,
      `patched === rebuild` on the serialized document.
- [ ] The four `unpatchable` cases return their reason and never a patch.
- [ ] Patch benchmark: < 50 ms at 20 MiB.

Validation: `cargo test`, parity, `npm run benchmark diffPatch`.

Gate: the equality property holds for every seed in the corpus; fallback cases are proven.

## Review gates

1. M1: key parity review — any key mismatch is a design bug, not a test tweak.
2. M2: scoring review — floats, tie-breaks and budget order.
3. M3: streaming review — frame limits and chunk boundaries.
4. M4: behaviour review — page tests unchanged.
5. M5: patch equality review with the recorded seeds.

## Rollback

M1–M3 are additive and unused; M4 is one commit switching the panel; M5 is additive until
the copy UI calls it. Reverting M4 restores the TypeScript diff.
