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
| `.vscodeignore` | Audited line-by-line against Hex: dropped `.yarnrc`, `vsc-extension-quickstart.md`, `images/demo.gif` and the Hex re-includes; added `package-lock.json` and `.gitattributes`. `vsce ls` lists the runtime files plus the intentional `docs/` and `examples/` documentation assets; no Hex-only path ships |
| `images/demo.gif` in `.vscodeignore` | Removed — the file does not exist in ARXML Scope |
| Root `scripts/` references | Removed with the scripts folder. `.github/scripts/`, `.trellis/scripts/` and `.agents/skills/*/scripts/` are real, ARXML/Trellis-owned paths |
| `docs/`, `examples/`, `schemas/`, `syntaxes/` | `docs/` now holds `README.md`, `ECUC_EDITOR.md` and `DIFF.md`; `examples/` holds `README.md` and the synthetic `synthetic-ecuc.arxml`. Both are real ECUC content, not Hex-shaped stubs. `schemas/` and `syntaxes/` remain intentionally absent: there is no shipped schema or grammar |
| Hex parser/memory/overlay/profile/scripting terms | No source references found; the remaining spec wording now says “VS Code-style” instead of naming Hex Scope |
| `src/test/benchmarks/` | Added `runBenchmark.ts` + `ecucLargeFileBenchmark.ts` (ECUC scan/rows/diff); `.fallowrc.json` entry added |
| `.trellis/spec/frontend/directory-structure.md:52` | **Resolved in `a6ef172`**: the `scripts/copy-webview-css.cjs` reference is gone; the layout now lists `dist/`/`out/` bundles and `src/test/benchmarks/`. Verified by the docs/spec child against the current tree |
| `.trellis/spec/frontend/testing.md` "Samples and benchmarks are evidence" | **Resolved in `a6ef172`**: the benchmark paragraph now describes `npm run benchmark`, `ecucLargeFileBenchmark.ts`, the CT `Benchmarks` job and the JSON summary lines. Verified by the docs/spec child |
| `package-lock.json` `esrecurse` entries | False positive: the dependency name contains the `srec` substring. ARXML-owned file, no action |

## Additional findings resolved by the docs/spec child

| Reference | Resolution |
|---|---|
| `.trellis/spec/frontend/component-guidelines.md`, `quality-guidelines.md`, `state-management.md`, `components/component-details-editor.md` | The re-scan payload was written as `{ type: 'model', rows, selectedId }`. The protocol has always been `{ type: 'document', document: { rows, selectedId, header } }`; every reference now matches `src/webviewProtocol.ts` and the page handlers |
| `.trellis/spec/frontend/directory-structure.md` render/style listing | Listed `render/html.ts`, `render/jsonScript.ts` and `styles/index.ts`, none of which exist. Corrected to `render/dom.ts`, `render/pageError.ts`, the real render helpers and `styles/tokens.css` + `base.css` |
| `.trellis/spec/frontend/components/component-diff-view.md` | Replaced the copied `setModel(model: any)` placeholder with the real `DocumentTreeViewModel` contract and removed the “matching Hex Scope” comparison |
| `.trellis/spec/frontend/hook-guidelines.md` | Was a template with five “(To be filled by the team)” sections. Replaced with the real contract: no web framework, no hooks; component classes, imported pure modules and host modules are the equivalents |
| `.trellis/spec/frontend/{component-guidelines,testing,state-management,quality-guidelines,type-safety}.md` | **Resolved by the docs/spec child**: the pages are a static `editorShell`/`diffShell` plus an esbuild bundle, not `renderHtml` with serialized `toString()` helpers. The stale `renderHtml` / `scriptTestUtils` / `virtualScrollScript` wording was replaced with the real modules and the jsdom-bundled page tests |
| `.trellis/spec/frontend/components/index.md` | Replaced the two “to fill during extraction” rows with links to the existing ContextMenu and DetailsEditor specs and listed every component folder |
| `.trellis/spec/frontend/index.md` | Added CSS Guidelines and Editor Lifecycle, marked Type Safety `Filled`, linked the guides index, and removed the `To fill` status |

## Gate

The repo-config/CI/benchmark child and the docs/spec child must run this audit before closing:

```bash
rg -n "demo\\.gif|hexscope|hex-scope|hexView|intelHex|srec|\\.hexscope|examples/|schemas/|syntaxes/|scripts/" \
  --glob '!node_modules/**' --glob '!dist/**' --glob '!out/**' --glob '!.git/**' .
```

Every hit must be either an ARXML-owned file that exists or removed.
