# Cleanup — implementation plan

1. Platform gate in `engineLoader.ts` + tests in `engine.test.ts`.
2. Rewrite `rust/README.md`; add `docs/ENGINE.md`; update `README.md` support list
   and `.vscodeignore` if `docs/` is excluded (it already is).
3. `deny.toml`, `.github/dependabot.yml`, cargo-deny step in `ct.yml`; run
   `cargo deny check` locally after installing the tool.
4. Expand `UT_Test` to the four-platform matrix; keep Ubuntu xvfb and artifacts.
5. Re-shape the edit benchmark fields and update every reader.
6. Changelog Unreleased entries.
7. Run:
   - `cargo deny check`
   - `npm run check-types`, `npm run lint`
   - `npm run benchmark -- editLatency` (or the suite filter)
   - YAML syntax check (actionlint if present) and `npm test` smoke.
8. Record any fuzz follow-up in the PRD before archiving.

## Validation

```bash
cargo deny --manifest-path rust/Cargo.toml check advisories bans sources licenses
npm run check-types
npm run lint
npm run benchmark
```

## Rollback

CI and docs changes are independent; revert individually if a platform job cannot
run on the repository's plan.
