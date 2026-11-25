# Audit and prune the TypeScript/Rust parity harness

## Goal

Make the Rust engine the only runtime implementation and remove or justify the
TypeScript-vs-Rust parity scaffolding under `scripts/parity*.mjs` and
`src/test/parity/`. Every retained parity check must have a named owner, a CI job and a
documented purpose; every other script, oracle, package alias and doc entry is removed.

The task must not delete a TypeScript module that still has a production consumer merely
because it duplicates a Rust implementation. It also must not leave a “parity” command
that is never run.

## Context

- `scripts/parity.mjs` is **not** an oracle comparison: it compares the fixture manifest
  (paths, sizes, SHA-256) with the Rust `arxml-cli fixture-manifest`. CI runs it.
- `scripts/parityRows.mjs`, `parityDiff.mjs`, `parityCopy.mjs` and `parityWords.mjs`
  bundle the TypeScript oracles in `src/test/parity/` and compare them with
  `arxml-cli`. CI runs only `parity` and `parity:copy`.
- `oracleRows.ts` is also imported by `src/test/extension/engine.test.ts`; the other
  oracles are script-only.
- The TypeScript core is not a runtime engine fallback: `src/host/engine/coreEngine.ts`
  states that the Rust process is the engine and the host is a client. However, parts of
  `src/core` are still production code for the webview/host (scanner, rows, word diff,
  diff model types and helpers).
- `docs/TEST_PLAN.md` currently mentions `parity:rows`; `package.json` exposes
  `parity`, `parity:rows`, `parity:diff`, `parity:copy`, `parity:words`.

## Requirements

- **Inventory**
  - List every `scripts/parity*.mjs`, `src/test/parity/oracle*.ts`, package alias,
    `.fallowrc.json` entry, CI step and doc mention.
  - Record the current pass/fail status of each command and whether it needs a debug
    `arxml-cli` build.
- **Classify each check**
  - `keep`: the TypeScript implementation is still a production path and drift against
    Rust is a real regression risk.
  - `remove`: the TypeScript implementation has no production consumer outside the
    oracle/test/preview layer.
  - `replace`: keep a Rust-only golden check but delete the TypeScript oracle.
  - For every classification, name the production consumers found by source search, not
    by assumption.
- **Location**
  - Default to deletion. A parity script/oracle is removed unless it protects a live
    TypeScript production path and runs in CI.
  - Do not relocate dead code into `src/test`; converting a check into a test is only for
    a check that still has value.
  - Test-only parity checks must not live in `scripts/`. `scripts/` is for build, package
    and release automation.
  - A retained check becomes a Mocha test under `src/test/parity` that runs with the
    normal test suite, or moves to a test-owned tools path only if a standalone process is
    unavoidable, with the reason documented.
  - Remove the esbuild oracle bundling step from retained checks; the compiled test code
    can import the oracle functions directly.
  - Do not add a new `scripts/parity*.mjs` entry.
- **Remove the stale layer**
  - Delete the script, oracle, package alias, CI step, `.fallowrc.json` entry and doc
    mention for every `remove` classification.
  - Do not leave a comment-only placeholder or a forwarding script.
- **Keep or replace the useful checks**
  - If a check is retained, add it to CI with a built `arxml-cli`, a timeout and a clear
    failure message.
  - If a TypeScript oracle is replaced by a Rust-only golden file, document how to
    regenerate it and keep the fixture deterministic.
- **Preserve production TypeScript**
  - Do not delete `src/core` code that the webview/host still imports.
  - Do not change the engine protocol, the copy planner contract or the row payload.
- **Docs and commands**
  - `package.json` contains only commands that are actually run.
  - `docs/TEST_PLAN.md`, `docs/README.md` and any workflow comments describe the final
    state; no stale `parity:*` names.
  - `AGENTS.md` gets only a short note if the verification commands change.

## Non-goals

- Rewriting the Rust core or changing its output.
- Removing TypeScript shared types/helpers used by the UI.
- Adding new parity checks for operations that are not already covered.
- Changing the engine protocol, fixture formats or copy semantics.
- Refactoring unrelated `src/core` modules.

## Acceptance criteria

- [ ] Every `parity*.mjs` and `oracle*.ts` is either retained with a documented
      production reason + CI job, or gone.
- [ ] No test-only parity runner remains in `scripts/`; retained checks live under a
      test-owned path and run in the normal test suite or CI.
- [ ] No `package.json` alias, CI step, `.fallowrc.json` entry or doc link points at a
      removed script.
- [ ] Retained checks run against a freshly built `arxml-cli` and fail loudly on a
      mismatch.
- [ ] Production TypeScript consumers are unchanged and still type-check.
- [ ] `npm run check-types`, `npm run lint`, `npm test`, `npm run engine:smoke`,
      `npm run rust:test`, fallow and the production bundle pass.
- [ ] `git diff --check` is clean.
