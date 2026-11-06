# Set up DESIGN.md for the webview design system

## Goal

Give coding agents a durable, machine-readable description of the webview visual identity, and keep
that description honest about VS Code theme ownership. The repository gets a root `DESIGN.md` that the
`@google/design.md` CLI validates, plus the tooling and documentation hooks that keep it current.

## Requirements

- **R1 Root document.** Add `DESIGN.md` at the repository root with YAML design tokens and the prose
  sections the format defines: Overview, Colors, Typography, Layout & Spacing, Elevation & Depth,
  Shapes, Components, Do's and Don'ts.
- **R2 Theme ownership is explicit.** The webview consumes `--vscode-*` variables so the host theme
  stays authoritative. The document must state that the variables are normative and that the concrete
  colour values are the Dark Modern reference the UI was tuned against.
- **R3 Lint-clean.** `DESIGN.md` must produce 0 errors and 0 warnings: every colour token is referenced
  by at least one component, and a `primary` colour exists.
- **R4 Values match the source.** Colour, typography, spacing, radius and component values must reflect
  `src/webview/styles/tokens.css`, `src/webview/styles/base.css`, the component stylesheets, and the
  exception log in `.trellis/spec/frontend/css-guidelines.md`.
- **R5 Tooling.** Provide a pinned `design:lint` npm script that fetches the CLI on demand with
  `npx -y -p @google/design.md@0.4.0` and invokes the `designmd` alias, so the repository takes on no
  transitive tree or dev-only advisory from the dependency.
- **R6 Pipeline gate.** Run the design lint from the existing `npm run lint` chain so `npm run compile`,
  `pretest` and CI gate it without editing a workflow.
- **R7 Discoverability.** Link the document from `docs/README.md` and add a short pointer in `AGENTS.md`
  outside the Trellis-managed block, so agents and contributors find it before changing webview UI.
- **R8 No runtime change.** No shipped TypeScript or CSS changes, no package version bump, and no
  `CHANGELOG.md` entry because the change is not user-visible.

## Acceptance Criteria

- [ ] **AC1** `npm run design:lint` exits 0 with `0 errors` and `0 warnings`.
- [ ] **AC2** Every literal and fixed token documented in `tokens.css` and the CSS exception log appears
      in `DESIGN.md` with the same value.
- [ ] **AC3** `npm run lint`, `npm run compile` and `npm test` pass.
- [ ] **AC4** `package.json` changes are limited to the `lint` and `design:lint` script lines;
      `package-lock.json` is unchanged.
- [ ] **AC5** `docs/README.md` links `DESIGN.md`, and the `AGENTS.md` pointer sits outside the
      `<!-- TRELLIS:START -->` / `<!-- TRELLIS:END -->` block.
- [ ] **AC6** `git diff` shows no changes under `src/` and no version change in `package.json`.

## Constraints

- The CLI is published as `@google/design.md` 0.4.x and its format is still alpha; the document must not
  promise stability beyond what the spec defines.
- The published CLI depends on `zod@^3`, which carries a dev-only memory-exhaustion advisory with no
  fix in that major line. The script fetches the CLI on demand instead of adding it to the lockfile.
- The linter rejects `var(...)` colour values, so token colours must be concrete CSS colours.
- On Windows the bare `design.md` bin name collides with Markdown file associations; scripts must use
  the `designmd` alias.
- The lint needs npm registry access on the first run in a fresh environment; `npm ci` already assumes
  the same access.
- All prose is English, in the existing repository voice.
