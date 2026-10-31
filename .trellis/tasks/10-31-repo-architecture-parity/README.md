# Pinned plan — read this first

This task is the source of truth for the Hex Scope architecture-parity effort. Read in order:

1. `prd.md` — requirements and acceptance criteria.
2. `gap-analysis.md` — file-by-file Hex Scope vs ARXML Scope comparison.
3. `design.md` — target repository, runtime, components, configs, CI, specs.
4. `implement.md` — staged execution and gates.
5. Child tasks — independently verifiable deliverables.

## The three user goals

1. Make the repository structurally match `D:\workspace\vscode-hex-scope`: root configs, folder
   layout, Trellis spec structure, package scripts, components, GitHub Actions/CT/benchmarks.
2. Keep the ECUC domain: single-file editor, sidebar, diff, search, large-file optimization.
3. Plan deeply here so a future session cannot miss a point. If the local Hex Scope checkout is
   unavailable, use `https://github.com/deviousprophet/vscode-hex-scope` as the source of truth.

## Non-negotiable points

- Delete the `scripts/` folder; no boot/CSS helper scripts.
- Editor and diff are bundled webview entrypoints, not serialized server-rendered scripts.
- All components live under `src/webview/components/<Name>/` with colocated CSS and a Trellis spec.
- Component tests are flat under `src/test/webview/components/`.
- Add an ECUC large-file benchmark and the Hex Scope CT benchmark job.
- Align root config files and package scripts with Hex Scope.
- Preserve ECUC behavior and large-file responsiveness.

## Current state (update when work lands)

- `10-31-webview-component-structure` is `in_progress`: webview folders/components exist, but the
  runtime is still server-rendered and `scripts/` remains.
- Working tree has uncommitted component/restructure changes. Do not discard them; finish and
  commit that child before starting the bundle-runtime child.
- `scripts/` currently contains `check-webview-boot.cjs`, `css-loader.cjs`, `copy-webview-css.cjs`.
- No benchmark suite or benchmark CI job yet.

## Status rule

This parent is planning-only. Create/start each child only after its PRD/design/implement artifacts
are complete and reviewed.
