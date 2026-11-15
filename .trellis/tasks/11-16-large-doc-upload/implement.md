# Large document upload — implementation plan

1. `rust/arxml-engine/src/main.rs`:
   - `Upload`, `UploadKind`, `uploads`, `next_upload`
   - `doc.open.begin/chunk/end`, `doc.resync.begin/chunk/end`, `upload.abort`
   - shared `finish_open` / `finish_resync`
   - unit tests for seq, cap, UTF-8 and clear-on-error.
2. `src/host/engine/coreEngine.ts`:
   - chunked `openDocument` with `DATAGRAM_LIMIT`, `CHUNK`, `MAX_DOCUMENT`
   - keep the single-frame branch for small text.
3. `src/host/engine/engineClient.ts`: expose `frameLimit` for tests if needed.
4. Tests:
   - `engine.test.ts` 70 MiB open, gap/duplicate rejection, single-frame unchanged
   - `scripts/engine-smoke.mjs` chunked open
5. Run `cargo fmt`, `cargo clippy`, `cargo test`, `engine:build`, `engine:smoke`,
   `npm run check-types`, targeted `npm test`.
6. Update `rust/README.md` with the chunked operations.

## Validation

```bash
cargo test --manifest-path rust/Cargo.toml --workspace
cargo fmt --manifest-path rust/Cargo.toml --all -- --check
cargo clippy --manifest-path rust/Cargo.toml --workspace --all-targets -- -D warnings
npm run engine:build && npm run engine:smoke
npm run check-types
npx vscode-test --grep "engine"
```

## Rollback

Revert the commit; the old `doc.open` path remains in the engine, so a host-only
rollback is possible.
