# Hex Scope ↔ ARXML Scope gap analysis

Source of truth: `D:\workspace\vscode-hex-scope` (fallback: `https://github.com/deviousprophet/vscode-hex-scope`).

## 1. Runtime architecture

| Hex Scope | ARXML Scope today | Gap |
|---|---|---|
| `src/webview/hexViewer.ts` + `diffViewer.ts` are browser bundles (`dist/webview.js`, `dist/diffViewer.js`) built by esbuild as IIFE | Pages are server-rendered HTML strings; page scripts are injected with `Function.prototype.toString()` | Must migrate both views to bundled webview entrypoints and `postMessage` data flow |
| CSS imported by component `.ts`, esbuild emits a CSS bundle; `.vscodeignore` keeps `src/webview/**/*.css` | CSS injected as strings into nonce `<style>`; `scripts/css-loader.cjs` + `scripts/copy-webview-css.cjs` support tests | Remove `scripts/`; let esbuild own CSS |
| Webview protocol modules (`webviewProtocol.ts`, `diffProtocol.ts`) | Host embeds JSON documents in HTML | Add typed protocol modules and message dispatch |
| No `scripts/` folder | `scripts/check-webview-boot.cjs`, `css-loader.cjs`, `copy-webview-css.cjs` | Delete all three; boot check is replaced by bundling + component tests |

## 2. Components

Hex Scope has one root: `src/webview/components/<Name>/` with `<Name>.ts`, render/paint layer, `<Name>.css`, tests flat at
`src/test/webview/components/<component-name>.test.ts`, and a spec per component under
`.trellis/spec/frontend/components/component-<name>.md`.

Current restructure already has:

```text
src/webview/components/
├── contextMenu/
├── detailsEditor/
├── diffView/
├── documentTree/
├── searchBar/
├── sidebar/{detailsPanel,conditionsPanel}/
└── toolbar/
```

Gaps:

- Component CSS import still needs the `scripts/` loader for the tsc test host; bundled-webview migration removes it.
- Component specs currently cover documentTree/diffView/toolbar/searchBar/sidebar; contextMenu and detailsEditor specs are `to fill`.
- Tests are partly still extension-host page tests; Hex Scope uses plain mocha + jsdom + `cssImportHook` for components.

## 3. Repository files

| File | Hex Scope | ARXML Scope | Action |
|---|---|---|---|
| `.gitattributes` | `* text=auto eol=lf` + Trellis journal union | Missing global eol; extra fixture pin | Add global rule, keep fixture pin |
| `.gitignore` | `dist`, `node_modules`, `.vscode-test/`, `*.vsix`, `src/**/*.js(.map)` | `src/test/data/` instead of src js rules | Align |
| `.vscodeignore` | excludes out/src/tests; keeps webview CSS and examples | excludes scripts/sample/package-lock | Replace with Hex-style entries; drop scripts |
| `.vscode-test.mjs` | temp workspace, no css loader | `mocha.require` scripts/css-loader, 10s timeout | Temp workspace; component tests via jsdom; no scripts |
| `.fallowrc.json` | entry: extension + webview entrypoints + tests + benchmarks | entry: tests/esbuild/scripts/.github | Point at webview entrypoints, tests, benchmarks; drop scripts |
| `esbuild.js` | 5 bundles: extension, script worker, parse worker, webview, diff | 1 extension bundle + CSS text loader | Add editor/diff webview bundles; remove text-loader need |
| `package.json` scripts | compile/watch/package/check-examples/benchmark | package runs boot check; compile-tests copies CSS; no benchmark | Align scripts, add benchmark, remove scripts references |
| `tsconfig.json` | Node16, ES2022, DOM | current | Add DOM lib; keep strict |
| `eslint.config.mjs` | same | same (newline) | Normalize newline |
| `LICENSE` | `Copyright (c) deviousprophet` | `2026` | Align |
| `AGENTS.md` | same | same | none |
| `docs/`, `examples/`, `schemas/`, `syntaxes/` | present | absent | Add docs/examples; schemas/syntaxes only if ECUC needs them |

## 4. CI / CT / benchmarks

Hex Scope:

- `ci.yml` → `ct.yml` → `package.yml`.
- `ct.yml` runs unit tests and a separate `Benchmarks` job (`npm run benchmark -- --continue`), uploading both logs.
- `fallow.yml` runs advisory analysis.
- GitHub scripts: release notes, changelog strip, test summary.

ARXML Scope:

- Workflows mostly copied already.
- Missing benchmark job and `src/test/benchmarks/` suite.
- `fallow.yml` has an extra config/advisory block; align or document.
- No `check-examples` script/examples.

## 5. Trellis spec structure

Hex Scope `frontend/` has `index.md`, `directory-structure.md`, `component-guidelines.md`, `css-guidelines.md`,
`type-safety.md`, `testing.md`, `quality-guidelines.md`, `state-management.md`, `editor-lifecycle.md`,
`hook-guidelines.md`, `components/` (index, template, per-component specs) and `guides/` (index, code-reuse,
cross-layer thinking).

ARXML Scope now has component specs but still misses `css-guidelines.md`, `editor-lifecycle.md`, `guides/`,
and component specs for contextMenu/detailsEditor.

## 6. Performance / large files

Hex Scope uses:

- virtualized memory grid, host-computed visible slices;
- overscan derived from viewport;
- benchmark suite for 64 MiB sources with retained-memory limits;
- diff panes as two independent virtual grids synced by host.

ARXML Scope now has `DocumentTreeView` virtualization in editor and two diff panes, but:

- no ECUC large-file benchmark;
- no CI benchmark job;
- large ARXML (1.3 MB / 4k rows) scroll frame was ~24 ms before incremental render; must keep the incremental render and add regression benchmark.

## 7. Removal of `scripts/`

Required once the webview runtime is bundled:

- `check-webview-boot.cjs` → delete; `npm run package` relies on separate webview bundles + component tests.
- `css-loader.cjs` / `copy-webview-css.cjs` → delete; esbuild CSS imports replace them.
- `.vscode-test.mjs` loses `mocha.require`; use Hex-style temp workspace.
- `package.json` `package`/`compile-tests` lose script calls.
- `.vscodeignore`/`.fallowrc` lose `scripts/` entries.
