# Blind-copy audit — Hex Scope references that may not exist here

Rule: every path, glob, command, script, workflow step, spec example and docs asset copied from Hex
Scope must be checked against ARXML Scope. If the target does not exist, either add the real ARXML
asset or remove the copied reference. Never keep a copied path because it exists in Hex Scope.

## Confirmed finding

- `.vscodeignore` contains `images/demo.gif`. ARXML Scope has no `images/demo.gif`; it only has
  `images/icon.png` and `images/icon.svg`. Remove the line unless a real ARXML demo GIF is added.

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
| `images/demo.gif` in `.vscodeignore` | Missing — remove or add a real ARXML demo |
| `scripts/` references | Removed with the scripts folder |
| `docs/`, `examples/`, `schemas/`, `syntaxes/` | Not present; do not create empty copies |
| Hex parser/memory/overlay/profile/scripting terms | No source references found |
| `src/test/benchmarks/` | Not created yet; benchmark child must add ECUC benchmarks, not hex parsers |

## Gate

The repo-config/CI/benchmark child and the docs/spec child must run this audit before closing:

```bash
rg -n "demo\\.gif|hexscope|hex-scope|hexView|intelHex|srec|\\.hexscope|examples/|schemas/|syntaxes/|scripts/" \
  --glob '!node_modules/**' --glob '!dist/**' --glob '!out/**' --glob '!.git/**' .
```

Every hit must be either an ARXML-owned file that exists or removed.
