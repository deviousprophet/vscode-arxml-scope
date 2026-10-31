# Blind-copy audit — Hex Scope references that may not exist here

Rule: every path, glob, command, script, workflow step, spec example and docs asset copied from Hex
Scope must be checked against ARXML Scope. If the target does not exist, either add the real ARXML
asset or remove the copied reference. Never keep a copied path because it exists in Hex Scope.

## Confirmed finding (resolved)

- `.vscodeignore` referenced `images/demo.gif`. ARXML Scope has no `images/demo.gif`; it only has
  `images/icon.png` and `images/icon.svg`. The line was removed by the config/CI/benchmark child.

## Files to audit

| File / area | Check |
|---|---|
| `.vscodeignore` | Every ignored path exists, or is a generated output; no Hex-only demo/examples/schemas paths |
| `.gitignore` | No Hex-only generated paths; ECUC fixtures/test data handled intentionally |
| `.gitattributes` | Global eol rule + ARXML fixture exception only |
| `.fallowrc.json` | Entry points exist: extension, editor/diff bundles, tests, benchmarks; no scripts/hex worker entries |
| `esbuild.js` | Bundles target real ARXML entrypoints; no hex worker/parse-worker bundles |
| `package.json` scripts | Every command exists; no boot-check/CSS-copy script calls; benchmark targets ECUC |
| `.vscode-test.mjs` | Temp workspace + ECUC test paths; no Hex profile/CSS loader |
| `tsconfig.json` | DOM/ES target matches bundled webviews; no Hex-only examples config |
| `eslint.config.mjs` | Rules target `src`; no Hex example/schema globs |
| `.github/workflows/*` | Commands exist; no hex-specific benchmark/test names; paths match this repo |
| `.github/scripts/*` | Release/test-summary scripts operate on this repo's format |
| `.trellis/spec/frontend/**` | ECUC terminology/examples only; no hex memory/overlay/profile terms |
| `README.md`, `CHANGELOG.md`, component specs | ECUC features/examples; no hex features or assets |
| `docs/`, `examples/`, `schemas/`, `syntaxes/` | Only create with real ARXML content; do not add empty Hex-shaped folders |

## Current findings

| Reference | Status |
|---|---|
| `.vscodeignore` | Audited line-by-line against Hex: dropped `.yarnrc`, `vsc-extension-quickstart.md`, `images/demo.gif` and the Hex re-includes; added `package-lock.json` and `.gitattributes`. `vsce ls` lists only the 11 runtime files |
| `images/demo.gif` in `.vscodeignore` | Removed — the file does not exist in ARXML Scope |
| Root `scripts/` references | Removed with the scripts folder. `.github/scripts/`, `.trellis/scripts/` and `.agents/skills/*/scripts/` are real, ARXML/Trellis-owned paths |
| `docs/`, `examples/`, `schemas/`, `syntaxes/` | Not present; do not create empty copies |
| Hex parser/memory/overlay/profile/scripting terms | No source references found |
| `src/test/benchmarks/` | Added `runBenchmark.ts` + `ecucLargeFileBenchmark.ts` (ECUC scan/rows/diff); `.fallowrc.json` entry added |
| `.trellis/spec/frontend/directory-structure.md:52` | Stale: references `scripts/copy-webview-css.cjs`, which does not exist. Docs/spec child must remove it and add `src/test/benchmarks/` to the layout |
| `.trellis/spec/frontend/testing.md` "Samples and benchmarks are evidence" | Stale: says the benchmark was removed; `npm run benchmark` and the CT `Benchmarks` job now run `ecucLargeFileBenchmark.ts`. Docs/spec child must update it |
| `package-lock.json` `esrecurse` entries | False positive: the dependency name contains the `srec` substring. ARXML-owned file, no action |

## Gate

The repo-config/CI/benchmark child and the docs/spec child must run this audit before closing:

```bash
rg -n "demo\\.gif|hexscope|hex-scope|hexView|intelHex|srec|\\.hexscope|examples/|schemas/|syntaxes/|scripts/" \
  --glob '!node_modules/**' --glob '!dist/**' --glob '!out/**' --glob '!.git/**' .
```

Every hit must be either an ARXML-owned file that exists or removed.
