# Copy planner in Rust — implementation plan

1. Add `rust/arxml-core/src/copy.rs` and `pub mod copy;` in `lib.rs`.
2. Port helpers and tests from `src/core/copy/planCopy.ts`.
3. Add `copy.plan` to `rust/arxml-engine/src/main.rs`.
4. Add `copy` to `rust/arxml-cli/src/main.rs`.
5. Add `src/test/parity/oracleCopy.ts` and `scripts/parityCopy.mjs`; wire
   `parity:copy` in `package.json` and `ct.yml`.
6. `src/host/engine/coreEngine.ts`: `EngineCopyRequest`, `EngineCopyPlan`, optional
   `planCopy` implementation calling `copy.plan`.
7. `src/host/diffPanel.ts`: replace the three TS planner call sites; remove the
   import. Keep `applyPlan` and `patchAfterCopy`.
8. Mark `src/core/copy/planCopy.ts` as the oracle in its header; production imports
   must be zero (`grep` gate or lint rule).
9. Run:
   - `cargo test`, `cargo fmt --check`, `cargo clippy`
   - `npm run parity:copy`
   - `npm run check-types`, `npm run lint`
   - `planMerge` and `compare` extension tests
10. Update `rust/README.md` operation list.

## Validation

```bash
cargo test --manifest-path rust/Cargo.toml --workspace
npm run engine:build
npm run parity:copy
npx vscode-test --grep "merge|compare"
```

Manual merge pass: copy across CRLF/LF, undo, copy into a dirty target, two missing
parent levels.

## Rollback

The engine op is additive. Reverting the host call sites restores the TS planner; the
Rust module can stay for parity.
