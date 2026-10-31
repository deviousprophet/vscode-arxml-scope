# Implementation plan — repository parity

## Preconditions

- Finish and commit the current `10-31-webview-component-structure` child first; its dirty files are
  the base for everything else.
- Verify `npm test` and `npm run package` before starting the runtime migration.
- Keep `D:\workspace\vscode-hex-scope` (or the GitHub fallback) open as the source of truth.

## Ordered children

### 1. `10-31-webview-component-structure` (existing)

Deliver:

- `src/webview/components/<Name>/` for documentTree, diffView, toolbar, searchBar, sidebar,
  detailsEditor and contextMenu.
- Composition roots `src/webview/editorViewer.ts` and `diffViewer.ts`.
- Colocated CSS, component specs, flat tests.
- `src/core` / `src/host` split.

Gate: editor/diff behavior unchanged; 413+ tests; package boot check.

### 2. `webview-bundle-runtime`

Deliver:

- Typed `webviewProtocol.ts` / `diffProtocol.ts`.
- Static HTML shells with `asWebviewUri` script/style links.
- esbuild bundles: `dist/editorViewer.js`, `dist/diffViewer.js` (browser IIFE) and CSS.
- Host posts data/intents; no serialized page functions.
- Delete `scripts/check-webview-boot.cjs`, `css-loader.cjs`, `copy-webview-css.cjs`.
- Update `package.json` / `.vscode-test.mjs` / `.vscodeignore` / `.fallowrc.json`.

Gate: editor + diff run from bundles; no `scripts/`; tests + package pass.

### 3. `repo-ci-benchmark-parity`

Deliver:

- `src/test/benchmarks/runBenchmark.ts` adapted from Hex Scope.
- `ecucLargeFileBenchmark.ts`: scan/build rows/diff timing and retained memory on a generated
  multi-MiB ECUC file.
- `npm run benchmark`.
- `ct.yml` Benchmarks job; logs uploaded.
- Align `ci.yml`, `package.yml`, `release.yml`, `fallow.yml`, `.gitattributes`, `.gitignore`,
  `.vscodeignore`, `.vscode-test.mjs`, `.fallowrc.json`, `esbuild.js`, `tsconfig.json`,
  `eslint.config.mjs`, `LICENSE`, `package.json` scripts.
- `docs/`, `examples/` where useful; `schemas/`/`syntaxes/` only if ECUC needs them.

Gate: benchmark runs locally and in CI; configs structurally match Hex Scope.

### 4. `trellis-docs-spec-parity`

Deliver:

- Frontend spec set: css-guidelines, editor-lifecycle, guides/ (index, code-reuse, cross-layer).
- Fill contextMenu/detailsEditor component specs.
- Keep `components/index.md` and template in sync with Hex Scope.
- Docs/examples for the editor/diff.

Gate: every component has a spec; spec index is complete.

## Final integration checklist

- [ ] `scripts/` deleted and unreferenced.
- [ ] Bundled webview entrypoints and protocol modules.
- [ ] Components under one root; colocated CSS/specs/tests.
- [ ] Benchmarks and CT benchmark job.
- [ ] Root configs and package scripts aligned.
- [ ] ECUC behavior unchanged; large-file probe bounded.
- [ ] `npm run check-types`, `npm run lint`, `npm test`, `npm run package`, `npm run benchmark` pass.

## Rollback

Each child is a commit. Revert the child to restore the previous runtime/config; domain behavior and
payloads stay unchanged.
