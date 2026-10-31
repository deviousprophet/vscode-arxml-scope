# Design: Hex Scope parity

## Target repository

```text
src/
├── extension.ts
├── bootWatchdog.ts
├── host/                      VS Code adapters (editor provider, diff panel, edits)
├── core/                      pure ECUC + diff + protocol-adjacent models
├── webview/
│   ├── editorViewer.ts        editor webview entrypoint (IIFE bundle)
│   ├── diffViewer.ts          diff webview entrypoint (IIFE bundle)
│   ├── components/<Name>/     one component root: ts + css + render/paint
│   ├── render/                shared DOM/virtual-scroll/search helpers
│   └── styles/                shared tokens/resets/layout
└── test/
    ├── core/
    ├── webview/components/
    ├── webview/page/
    ├── extension/
    └── benchmarks/

docs/ examples/                 user docs and ECUC samples
.trellis/spec/frontend/
├── index.md, directory-structure.md, component-guidelines.md
├── css-guidelines.md, type-safety.md, testing.md, quality-guidelines.md
├── state-management.md, editor-lifecycle.md, hook-guidelines.md
├── components/ (index, template, per-component specs)
└── guides/ (index, code-reuse, cross-layer)
```

## Runtime migration

Current pages are host-generated HTML with serialized functions. Replace with:

1. **Protocol modules**: `src/webviewProtocol.ts` (editor) and `diffProtocol.ts` (diff) define
   host→webview data/commands and webview→host intents.
2. **Static shells**: host renders a shell with CSP + `asWebviewUri` script/style links.
3. **Entrypoints**: `webview/editorViewer.ts` and `webview/diffViewer.ts` request/receive data and
   mount components.
4. **Host**: providers post a `document`/`diff` message and handle intents; no JSON embedded in HTML
   and no serialized page functions.
5. **Build**: esbuild adds `dist/editorViewer.js` and `dist/diffViewer.js` (browser IIFE), and CSS
   imports are bundled by esbuild. `dist/webview.css`/`diffViewer.css` are exposed through
   `asWebviewUri`.

This removes the need for:

- `scripts/check-webview-boot.cjs`
- `scripts/css-loader.cjs`
- `scripts/copy-webview-css.cjs`

## Scripts/config parity

| File | Change |
|---|---|
| `package.json` | Add `benchmark`; remove boot/CSS script calls; align compile/watch/package with Hex |
| `.vscode-test.mjs` | Disposable temp workspace like Hex; drop css-loader require |
| `.vscodeignore` | Hex-style ignores; remove scripts/sample/package-lock entries |
| `.fallowrc` | Entrypoints include webview bundles and benchmarks; remove scripts |
| `esbuild.js` | Extension + editor/diff webview bundles; CSS is real esbuild output |
| `.gitattributes` | `* text=auto eol=lf` plus fixture exception |
| `.gitignore` | Align with Hex |
| `tsconfig.json` | ES2022 + DOM + mocha/node |
| `eslint.config.mjs` | Normalize to Hex |
| `LICENSE` | Match copyright line |

## CI / CT / benchmarks

- Keep `ci.yml` → `ct.yml` → `package.yml`.
- Add Hex Scope's `Benchmarks` job to `ct.yml`:
  `npm run benchmark -- --continue`, upload `benchmark-output.log`.
- Add `src/test/benchmarks/runBenchmark.ts` (copied/adapted from Hex) and
  `ecucLargeFileBenchmark.ts` measuring:
  - scan + build rows for a generated multi-MiB ECUC file,
  - diff build for two large files,
  - retained memory and elapsed time.
- Keep `fallow.yml` advisory until the backlog is zero, then align fail-on-issues.

## Trellis spec parity

- Add `css-guidelines.md`, `editor-lifecycle.md`, `guides/` index + code-reuse + cross-layer guides.
- Fill component specs for contextMenu and detailsEditor.
- Keep per-component specs next to the component implementation.

## Adaptation, not copy-paste

- Copy folder/process shapes, not domain behavior.
- Component names and contracts are adapted to ECUC (DocumentTree, DiffView, SearchBar, Sidebar).
- Do not port hex memory, overlay, profile, scripting, Intel HEX/SREC/binary parsers or fixtures.
- Workflows/benchmarks keep the same structure with ECUC commands, ARXML fixtures and ECUC metrics.
- Docs/spec examples use ECUC terminology only.

## Migration order

1. **Bundle the webview runtime** (editor + diff), add protocols, switch host shells to URIs, delete
   scripts folder and CSS loader; keep behavior.
2. **Finish component structure** (existing child task): DocumentTree, diffView, toolbar, searchBar,
   sidebar, detailsEditor, contextMenu, colocated CSS/specs.
3. **Repo config/CI/benchmarks**: package scripts, workflows, benchmark suite, configs.
4. **Docs/spec parity**: frontend spec set, guides, docs/examples, component specs.
5. **Integration**: full tests, package boot, benchmark, large-file manual probe.

## Child map

- `10-31-webview-component-structure` (existing) — components + composition roots.
- New: `webview-bundle-runtime` — protocols, static shells, esbuild webview bundles, scripts removal.
- New: `repo-ci-benchmark-parity` — package/config/workflows/benchmarks.
- New: `trellis-docs-spec-parity` — frontend specs/guides/docs/examples.

## Risks

- Bundled webviews change the CSP and asset loading; verify VSIX packaging.
- Moving serialized logic to bundled scripts can change function-name assumptions; remove them.
- Benchmarks must not run in normal tests.
- Large path churn: each child is independently green; no mega-commit.

## Rollback

Each child is a commit. Revert that child to restore the previous runtime/config; domain behavior and
payloads stay unchanged.
