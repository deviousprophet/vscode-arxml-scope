# Repository architecture parity with Hex Scope

## Goal

Make ARXML Scope a structural sibling of Hex Scope: same repository layout, webview runtime, reusable
component rules, Trellis spec structure, package scripts, CI/CT/benchmark process and configs. Keep the
ECUC domain distinct.

## Requirements

**Runtime**

- Editor and diff webviews are bundled browser entrypoints, like Hex Scope's `hexViewer.ts` and
  `diffViewer.ts`.
- Host and webview communicate through typed protocol modules; pages are static shells.
- Component CSS is colocated and bundled by esbuild.

**Structure**

- `src/webview/components/<Name>/` is the only component root.
- `src/host/` owns VS Code effects; `src/core/` owns pure ECUC/diff logic.
- Tests mirror: `src/test/core`, `src/test/webview`, `src/test/extension`, `src/test/benchmarks`.
- Trellis specs mirror Hex Scope: frontend index, directory structure, component guidelines, CSS
  guidelines, type safety, testing, quality, state, editor lifecycle, components/ and guides/.

**Scripts**

- Delete the `scripts/` folder.
- Replace boot/CSS helper scripts with the bundled-webview build.
- `.vscode-test.mjs`, `package.json`, `.vscodeignore` and `.fallowrc.json` no longer reference
  `scripts/`.

**Process**

- `package.json` scripts match Hex Scope's shape, plus ECUC-specific checks where needed.
- CI → CT (unit tests + benchmarks) → package, matching Hex Scope.
- Add an ECUC large-file benchmark suite and `npm run benchmark`.
- Configs (`.gitattributes`, `.gitignore`, `.vscodeignore`, `.vscode-test.mjs`, `.fallowrc.json`,
  `esbuild.js`, `tsconfig.json`, `eslint.config.mjs`, `LICENSE`) align with Hex Scope.

**Domain**

- ECUC scanning, rows, conditions, annotations, sidebar, search and semantic diff behavior stays.
- Large ARXML files remain virtualized and responsive in both views.
- Hex Scope structure is adapted, never pasted blindly: no hex memory/overlay/scripting features,
  no hex parsers, no hex fixtures or terminology. Workflow shape is shared; ECUC commands, fixtures,
  benchmarks and docs are domain-specific.

## Acceptance Criteria

- [ ] `scripts/` no longer exists and nothing references it.
- [ ] Editor and diff run from bundled webview entrypoints.
- [ ] Components live under `src/webview/components/<Name>/` with colocated CSS and specs.
- [ ] Tests/benchmarks mirror Hex Scope's `src/test` layout.
- [ ] CI runs UT and benchmark jobs; package/release workflows match.
- [ ] Configs are structurally equivalent to Hex Scope.
- [ ] Editor/diff behavior is unchanged and large-file probes stay bounded.
- [ ] `npm run check-types`, `npm run lint`, `npm test`, `npm run package`, `npm run benchmark` pass.
