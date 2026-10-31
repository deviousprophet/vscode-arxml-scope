# Design: repo process parity

## package.json

Target scripts:

```json
"compile": "npm run check-types && npm run lint && node esbuild.js",
"package": "npm run check-types && npm run lint && node esbuild.js --production",
"compile-tests": "tsc -p . --outDir out",
"pretest": "npm run compile-tests && npm run compile && npm run lint",
"benchmark": "node src/test/benchmarks/runBenchmark.ts"
```

No boot/CSS script calls.

## Benchmark suite

`runBenchmark.ts` copies Hex Scope: discovers `*Benchmark.ts`, bundles each with esbuild, runs under
`node --expose-gc`, supports `--continue` and a name filter.

`ecucLargeFileBenchmark.ts`:

- generate a multi-MiB ECUC ARXML (modules/containers/parameters),
- measure scan + buildRows elapsed and retained heap,
- build a two-side diff and measure elapsed/retained,
- JSON lines, hard limits fail the run.
- Reuse Hex Scope's typed log shape so the ported summary renderers work unchanged:
  `_type: "large-file-load"` with `name` of `scan` / `rows` / `diff`, and one
  `_type: "large-file-summary"` line with total retained memory.

## CI

- `ct.yml`: UT job + Benchmarks job (`npm run benchmark -- --continue`, upload log).
- `ct.yml` Finalize must `needs: [UT_Test, Benchmarks]`, check both results, download both
  logs, and add a `Benchmark Summary` step (same shape as Hex Scope's Finalize).
- `.github/scripts/summarize-tests.mjs`: port Hex Scope's typed benchmark registry
  (`large-file-load`, `large-file-summary`, `memory-release`) plus `summarizeTyped()` dispatch.
  This repo's current script only parses Mocha output, so benchmark JSON lines would render
  nothing without this.
- `ci.yml`: CT → Package.
- `package.yml`/`release.yml`: unchanged except script/version references.
- `fallow.yml`: align advisory setting with the documented backlog.

## Configs

- `.gitattributes`: `* text=auto eol=lf` + fixture exception.
- `.gitignore`: Hex entries plus ECUC test data.
- `.vscodeignore`: audit Hex Scope's file line by line — keep / adapt / drop each line with a
  reason. Keep only paths that exist here, are generated output, or must stay out of the VSIX.
  Drop Hex-only entries (`images/demo.gif`, `.yarnrc`, `vsc-extension-quickstart.md` if absent,
  `!examples/**` re-includes) and the `!src/webview/**/*.css` re-include (CSS is bundled into
  `dist/`). Add what this layout needs that Hex's does not (`package-lock.json`,
  `.gitattributes`). Do not keep dead no-op lines for parity.
- `.vscode-test.mjs`: add Hex Scope's disposable temp workspace (`mkdtempSync` + `--folder-uri`)
  so tests never write into the repo. **Keep** the existing `cssImportHook` require and the 10s
  mocha timeout: this repo's webview tests `require()` component modules that side-effect import
  CSS, and tsc does not copy `.css` files into `out/`. Removing the hook would break the suite.
  This is a deliberate divergence from Hex Scope (its tests do not import CSS).
- `.fallowrc`: entrypoints = extension + webview entrypoints + tests + benchmarks.
- `tsconfig`: ES2022 + DOM + mocha/node.
- `LICENSE`: match Hex copyright line (`Copyright (c) deviousprophet`).

## Validation

Local `npm run benchmark`; CI logs; full gates.
