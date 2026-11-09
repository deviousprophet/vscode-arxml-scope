# Rust core engine

The Rust workspace contains the native core required by the extension:

- `arxml-core` — pure engine library; no Node or VS Code dependency.
- `arxml-node` — N-API binding (`napi-rs`, N-API 8).
- `arxml-cli` — debug probe and fixture-manifest parity helper.

## Build and test

```bash
cargo test --manifest-path rust/Cargo.toml --workspace
cargo clippy --manifest-path rust/Cargo.toml --workspace --all-targets -- -D warnings
npm run rust:build
npm run rust:smoke
npm run parity
```

`npm run rust:build` writes the platform addon to
`dist/native/<platform>-<arch>/arxml_node.node`. The extension loader uses that path
automatically. There is no TypeScript core fallback and no engine selection setting: a
missing or incompatible addon is an activation error. The addon is required by
`npm run compile`, `npm test`, `npm run package` and the release/CI workflows.

Built `.node` files and `rust/target/` are ignored; the native artifact is a release/CI
artifact, not a source file.
