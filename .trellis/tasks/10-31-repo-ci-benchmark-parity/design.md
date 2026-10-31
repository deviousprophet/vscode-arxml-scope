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

## CI

- `ct.yml`: UT job + Benchmarks job (`npm run benchmark -- --continue`, upload log).
- `ci.yml`: CT → Package.
- `package.yml`/`release.yml`: unchanged except script/version references.
- `fallow.yml`: align advisory setting with the documented backlog.

## Configs

- `.gitattributes`: `* text=auto eol=lf` + fixture exception.
- `.gitignore`: Hex entries plus ECUC test data.
- `.vscodeignore`: no scripts/sample/package-lock; keep webview assets.
- `.vscode-test.mjs`: disposable temp workspace, no CSS loader.
- `.fallowrc`: entrypoints = extension + webview entrypoints + tests + benchmarks.
- `tsconfig`: ES2022 + DOM + mocha/node.
- `LICENSE`: match Hex copyright line.

## Validation

Local `npm run benchmark`; CI logs; full gates.
