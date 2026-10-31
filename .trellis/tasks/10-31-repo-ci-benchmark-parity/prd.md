# Align repo configs, CI, CT and benchmarks

## Goal

Match Hex Scope's repository process: package scripts, root configs, CI/CT workflows and a large-file
benchmark suite.

## Requirements

- `package.json` scripts follow Hex Scope shape, add `benchmark`, remove scripts-folder calls.
- Align `.gitattributes`, `.gitignore`, `.vscodeignore`, `.vscode-test.mjs`, `.fallowrc.json`,
  `esbuild.js`, `tsconfig.json`, `eslint.config.mjs`, `LICENSE`.
- Add `src/test/benchmarks/runBenchmark.ts` (Hex Scope pattern).
- Add `ecucLargeFileBenchmark.ts` covering scan/rows/diff timing and retained memory.
- Add the CT `Benchmarks` job with `npm run benchmark -- --continue`.
- Keep `ci.yml → ct.yml → package.yml`; align `release.yml` and `fallow.yml`.
- Add `docs/`, `examples/` where useful.

## Acceptance

- [ ] `npm run benchmark` runs the ECUC benchmark.
- [ ] CI runs UT + benchmarks, uploads logs.
- [ ] Configs are structurally equivalent to Hex Scope.
- [ ] No script-folder references remain.
- [ ] Full gates + package pass.
