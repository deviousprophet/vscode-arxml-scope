# Research — @google/design.md CLI

Date: 2026-11-07

## Package

- npm package: `@google/design.md`, version `0.4.0` at the time of research.
- Bins: `design.md` and `designmd`, both resolving to `dist/index.js`.
- Node engine: `>=18`.
- Commands: `lint`, `diff`, `export` (`json-tailwind`, `css-tailwind`, `tailwind`, `dtcg`).
- `lint` exit code is `1` on errors, `0` otherwise; warnings do not fail the command.

## Windows

The `design.md` bin name collides with the Markdown file association in PowerShell. The package
recommends the dot-free alias, either through `npx`:

```powershell
npx -p "@google/design.md" designmd lint DESIGN.md
```

or through a `package.json` script, where npm resolves `node_modules/.bin/designmd.cmd`:

```json
"design:lint": "designmd lint DESIGN.md"
```

## Validation behaviour observed on 0.4.0

Probe documents were linted with `designmd lint --format json <file>`.

- `colors` values must be concrete CSS colours. `var(--vscode-focusBorder, #0078d4)` is rejected:
  `'...' is not a valid color. Expected a CSS color value`.
- `typography.fontFamily` accepts a `var(...)` string, so the editor font stack can stay verbatim.
- A missing `primary` colour raises a `missing-primary` warning.
- Every colour token must be referenced by at least one component; otherwise the linter emits
  `orphaned-tokens` warnings. Typography, rounded and spacing tokens were not checked for orphans in
  the probe.
- Component keys accept `backgroundColor`, `textColor`, `typography`, `rounded` and `padding`; the
  probe produced no warnings for this set.
- A document with the eight expected sections, 22 referenced colour tokens, four typography tokens,
  five radii and six spacing steps lints with **0 errors, 0 warnings, 1 info** (token summary).
- `rgba(...)` values and 8-digit hex values are accepted.

## Registry state and the zod advisory

- The only published version is `0.4.0`. It depends on `zod@^3.24.0`.
- `zod@<4.6.6` has `GHSA-mrhx-c7xc-m3w5`: memory exhaustion while validating oversized constrained
  collections (CVSS 7.5). The advisory has no fix inside the 3.x line.
- The project's `main` branch already depends on `zod@^4.6.7`, but no release contains that change.
- Installing `0.4.0` adds 94 entries to the lockfile and introduces the repository's only high-severity
  advisory. The package is dev-only and never ships in the VSIX.
- Decision: run the CLI through `npx -y -p @google/design.md@0.4.0` in the npm script instead of
  adding it to the lockfile. The version stays pinned, the audit surface is unchanged, and the only
  cost is registry access on the first run in a fresh environment.

## Consequence for this repository

The runtime is theme-owned (`--vscode-*`), so `DESIGN.md` carries a concrete Dark Modern *reference*
palette and states in prose that the variables are normative. The document is kept warning-free by
referencing every colour token from a real component and defining `primary`.
