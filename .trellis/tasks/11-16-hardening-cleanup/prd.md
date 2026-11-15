# Engine hardening cleanup and CI

## Goal

Close the non-code findings: make the unsupported-platform failure actionable, fix
the Rust documentation drift, add supply-chain gates, run the extension-host suites
on every shipped platform, and label the benchmark path that triggers a full resync.

## Requirements

- **Platforms (finding 7, P9):** `enginePath`/`resolveEngine` names the supported
  targets when the current platform has no binary: `linux-x64`, `win32-x64`,
  `darwin-x64`, `darwin-arm64`. The error is distinct from "not built" and includes
  the source-build hint. README and `docs/` state the supported list explicitly.
  Do not add untested binaries.
- **Docs drift (finding 9):** `rust/README.md` lists every operation, including
  `diff.compute`, `diff.patch`, `doc.rows` and the new chunk/copy/health operations;
  the status paragraph no longer says the diff port "remains". `docs/` gets a short
  engine page with the protocol, restart policy and support matrix.
- **Supply chain (finding 10):** add `deny.toml`, a CI `cargo-deny` job covering
  advisories, licenses, bans and sources, and `.github/dependabot.yml` for npm and
  Cargo. Add a `cargo fuzz` target skeleton for the scanner only if it does not add
  an unrun job; otherwise record it as a follow-up in the PRD.
- **Extension-host tests (finding 11):** run `npm test` on linux-x64, win32-x64,
  darwin-x64 and darwin-arm64 in CI, not just Ubuntu. Keep the existing Ubuntu
  artifact and summary behavior.
- **Benchmark label (finding 4 note):** the edit benchmark reports a real value edit
  (`valueUpdateMs`, using the `doc.plan` span) separately from the arbitrary-byte
  replacement that falls back to a full resync (`resyncMs`), with a `path` label.
- **Changelog:** add an `Unreleased` section; do not bump the version.

## Acceptance criteria

- [ ] `resolveEngine` on an unsupported platform rejects with a message that lists
      the four supported targets and does not say "run npm run engine:build" alone.
- [ ] `rust/README.md` operations list matches `main.rs` dispatch exactly.
- [ ] `cargo deny check` passes locally or its config is validated by the CI job.
- [ ] Dependabot opens grouped npm and Cargo updates weekly.
- [ ] CI has an extension-host job for all four shipped targets; Linux still uses
      xvfb.
- [ ] The benchmark output has `valueUpdateMs`, `resyncMs` and a path label; the
      existing `updateMs` field is gone or aliased with a clear label.
- [ ] `CHANGELOG.md` has `## [Unreleased]` entries and `package.json` version is
      unchanged.
- [ ] No release workflow, tag or marketplace publish is triggered.

## Constraints

- Do not add arm64/Alpine binaries without a build and smoke run on that platform.
- CI additions must not make the PR unable to pass on forks without secrets.
- Keep the changelog in Keep a Changelog style and English.
