# Cleanup — technical design

## Platform gate

`src/host/engine/engineLoader.ts`:

```ts
const SUPPORTED = ['linux-x64', 'win32-x64', 'darwin-x64', 'darwin-arm64'];
```

Before spawning, `enginePath` still returns the conventional path. `resolveEngine`
checks the target:

```ts
if (!SUPPORTED.includes(target)) {
  throw new Error(
    `ARXML Scope has no Rust engine for ${target}. Supported: ${SUPPORTED.join(', ')}. ` +
    `Build from source with "npm run engine:build" on a supported platform.`
  );
}
```

The "not built" branch stays for a supported target whose binary is missing.

## Docs

- `rust/README.md`: rewrite the operations line as a table or list generated from
  `main.rs`; add chunked upload, copy, health/restart and platform sections.
- `docs/ENGINE.md`: new short page: process model, protocol frame, restart/backoff,
  document cap, supported targets, how to read the status command.
- Remove the stale task reference in the README status paragraph.

## Supply chain

`deny.toml`:

```toml
[advisories]
yanked = "deny"

[licenses]
allow = ["MIT", "Apache-2.0", "Apache-2.0 WITH LLVM-exception", "BSD-2-Clause",
         "BSD-3-Clause", "ISC", "Unicode-3.0", "Zlib", "CC0-1.0"]

[bans]
multiple-versions = "warn"
wildcards = "deny"

[sources]
unknown-registry = "deny"
unknown-git = "deny"
```

CI job in `ct.yml`:

```yaml
- uses: taiki-e/install-action@cargo-deny
- run: cargo deny --manifest-path rust/Cargo.toml check advisories bans sources licenses
```

The license allowlist is adjusted to the actual `cargo deny check licenses` output,
not guessed. `cargo deny` is installed locally to validate the file before CI.

`.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly }
    groups: { npm: { patterns: ["*"] } }
  - package-ecosystem: cargo
    directory: /rust
    schedule: { interval: weekly }
    groups: { cargo: { patterns: ["*"] } }
```

Fuzzing: add `rust/fuzz/Cargo.toml` and a scanner target only if `cargo fuzz`
metadata can be checked in CI without nightly; otherwise leave a follow-up note in
the PRD and the PR body. Do not add a job that never runs.

## Extension-host matrix

Change `UT_Test` in `.github/workflows/ct.yml` to:

```yaml
strategy:
  fail-fast: false
  matrix:
    os: [ubuntu-latest, windows-latest, macos-15-intel, macos-15]
runs-on: ${{ matrix.os }}
```

Test step:

```yaml
- name: Run Tests (Linux)
  if: runner.os == 'Linux'
  run: xvfb-run -a npm test 2>&1 | tee unit-test-output.log
- name: Run Tests (macOS/Windows)
  if: runner.os != 'Linux'
  run: npm test 2>&1 | tee unit-test-output.log
```

Artifact name gains `-${{ matrix.os }}`; the Finalize summary downloads the first
available Linux log and keeps the existing env contract.

## Benchmark

`engineEditBenchmark.ts`:
- keep `planOnce`;
- add `valueOnce(client, docId, plan.record.range, value)` that applies the plan's
  exact span;
- keep `resyncOnce` (current `updateOnce`) for the arbitrary-byte case;
- report `{valueUpdateMs, resyncMs, updatePath: "value" | "resync", pushedBytes}`.

`ecucLargeFileBenchmark.ts` and docs that read `updateMs` are updated to the new
field; `src/test/benchmarks/runBenchmark.ts` formatting is checked.

## Changelog

`CHANGELOG.md` under `## [Unreleased]`:
- Added: engine restart/health, >64 MiB documents, copy planner in Rust, new rename
  pairing.
- Fixed: rename gaps, stale docs, benchmark label.
No version bump.
