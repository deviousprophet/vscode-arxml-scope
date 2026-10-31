# Pinned plan — read this first

This task is the source of truth for the Hex Scope architecture-parity effort. Read in order:

1. `prd.md` — requirements and acceptance criteria.
2. `gap-analysis.md` — file-by-file Hex Scope vs ARXML Scope comparison.
3. `design.md` — target repository, runtime, components, configs, CI, specs.
4. `implement.md` — staged execution and gates.
5. `gap-analysis.md` — file-by-file comparison.
6. `blind-copy-audit.md` — copied paths/commands/specs that must be checked or removed.
7. Child tasks — independently verifiable deliverables.

## The three user goals

1. Make the repository structurally match `D:\workspace\vscode-hex-scope`: root configs, folder
   layout, Trellis spec structure, package scripts, components, GitHub Actions/CT/benchmarks.
2. Keep the ECUC domain: single-file editor, sidebar, diff, search, large-file optimization.
3. Plan deeply here so a future session cannot miss a point. If the local Hex Scope checkout is
   unavailable, use `https://github.com/deviousprophet/vscode-hex-scope` as the source of truth.

## Adaptation rule (not blind copy)

Hex Scope is the structural reference, not a source to paste. For every copied item, adapt it to ECUC:

- Keep the ECUC scanner, rows, conditions, annotations, details and semantic diff.
- Do not copy hex filesystem/memory/overlay/profile/scripting features.
- Rename hex components/helpers to ECUC concepts; a component boundary may be reused, its hex
  behaviour may not.
- CI/workflow shape is shared; commands and fixtures are ECUC.
- Benchmarks measure ECUC scan, row build, diff build and memory, not Intel HEX/SREC parsing.
- Docs/examples use synthetic ARXML, not hex dumps.
- Component specs use ECUC examples; no placeholder hex terminology.

## Non-negotiable points

- Delete the `scripts/` folder; no boot/CSS helper scripts.
- Editor and diff are bundled webview entrypoints, not serialized server-rendered scripts.
- All components live under `src/webview/components/<Name>/` with colocated CSS and a Trellis spec.
- Component tests are flat under `src/test/webview/components/`.
- Add an ECUC large-file benchmark and the Hex Scope CT benchmark job.
- Align root config files and package scripts with Hex Scope.
- Preserve ECUC behavior and large-file responsiveness.

## Current state (update when work lands)

- `10-31-webview-component-structure` — **done** (`1d43994`): one component root,
  composition roots, host/core split, 431 tests at that point.
- `10-31-webview-bundle-runtime` — **done** (`746ce11`): bundled editor/diff entrypoints,
  typed protocols, static shells, `scripts/` deleted, 381 passing, package exit 0.
- `10-31-repo-ci-benchmark-parity` — **done** (`9a0f6e5`..`9dfee40`, archived `df0931b`):
  ECUC large-file benchmark suite, CT `Benchmarks` job, typed benchmark summaries,
  test workspace/temp-dir fixes, line-by-line `.vscodeignore` audit (`vsce ls` = 11
  runtime files), root config alignment.
- `10-31-trellis-docs-spec-parity` — **in progress**: `css-guidelines.md`,
  `editor-lifecycle.md`, real `type-safety.md`, component spec completion, `docs/`,
  `examples/`, README trim.
- No `scripts/` folder exists.
- Benchmark suite and benchmark CI job exist.
- Next work: finish the docs/spec child, then final integration review and parent archive.

## Status rule

This parent is planning-only. Create/start each child only after its PRD/design/implement artifacts
are complete and reviewed.
