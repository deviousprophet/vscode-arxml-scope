# v0.11.0 engine hardening — execution plan

## Order

1. **Baseline** — record `cargo test`, `npm run check-types`, `npm run lint` and
   `parity:diff` on the branch point. Keep the output for comparison.
2. **Supervisor** (`11-16-engine-supervisor`) — protocol-neutral host change; finish
   first because the restart path is the safety net for every later test.
3. **Chunked upload** (`11-16-large-doc-upload`) — engine and client change; uses the
   supervisor to recover from a failed upload test.
4. **Rename matching** (`11-16-rename-matching`) — Rust and TypeScript oracle change;
   parity is the gate.
5. **Copy planner** (`11-16-copy-planner-rust`) — new Rust module and protocol op;
   host glue only.
6. **Cleanup** (`11-16-hardening-cleanup`) — docs, platforms, CI, benchmark label.
7. **Integration** — full sweep, changelog, review skills, PR.

## Commands per check

```bash
cargo test --manifest-path rust/Cargo.toml --workspace
cargo fmt --manifest-path rust/Cargo.toml --all -- --check
cargo clippy --manifest-path rust/Cargo.toml --workspace --all-targets -- -D warnings
npm run check-types
npm run lint
npm run engine:build
npm run engine:smoke
npm run parity
npm run parity:rows
npm run parity:diff
npm run parity:words
npm test
```

## Review gates

- After supervisor: kill the engine mid-session and confirm edit/diff recover; no
  TypeScript fallback appears.
- After chunked upload: open a >64 MiB document through `EngineClient`; confirm the
  document id and text length; confirm a bad chunk order is refused.
- After rename matching: rerun the review's shape matrix; confirm the no-false-pair
  cases stay at zero pairs.
- After copy planner: compare host output bytes with the TypeScript oracle; manual
  merge copy on both line-ending styles.
- After cleanup: `rust/README.md` lists every operation; CI includes the new jobs;
  changelog has an Unreleased entry.

## Rollback points

- Each child is a separate commit. If a child fails its gate, revert that commit and
  leave the child archived as superseded in the PR notes.
- The protocol stays additive, so the engine and host can be reverted independently.

## Out of scope

P3, P4, P5, R2, R3, R6 and R7 are recorded in the PRD. Do not start them in this
task; their designs need separate measurements and a real-project soak.
