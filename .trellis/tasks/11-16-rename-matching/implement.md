# Rename matching — implementation plan

1. Rust `rust/arxml-core/src/diff.rs`:
   - `mask_self(text, name)`
   - `child_key(side, node, substitutions, self_name)`
   - `child_blob(side, node, self_name)`
   - pass `name_of(side, node)` from `semantic_nodes`
   - comment the candidate-group order.
2. TypeScript `src/core/diff/diffModel.ts`: mirror the three functions exactly.
3. Rust tests: shape matrix at 10/50/200/500, false-pair cases, deterministic rerun.
4. TypeScript tests: the same matrix; keep the existing expectations for unrelated
   replacements and identity pairs.
5. Fixtures:
   - `semantic/whole-token.left.arxml` / `.right.arxml`
   - `semantic/new-before.left.arxml` / `.right.arxml`
   and add them to `scripts/parityDiff.mjs` named pairs.
6. Run:
   - `cargo test`, `cargo fmt --check`, `cargo clippy -D warnings`
   - `npm run check-types`, `npm run lint`
   - `npm run parity:diff`
   - `npm run benchmark -- renameScale`
   - targeted `diffModel` tests.
7. Update `src/core/diff/diffModel.ts` comments so Strict and semantic behavior stay
   documented.

## Validation

```bash
cargo test --manifest-path rust/Cargo.toml -p arxml-core
npm run parity:diff
npm run benchmark -- renameScale
npx mocha ... (diffModel tests through the project runner)
```

## Rollback

The change is confined to the semantic scorer. Revert the commit; Strict and all
identity paths are untouched.
