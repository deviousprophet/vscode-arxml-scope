# Design — DESIGN.md setup

## 1. Document shape

`DESIGN.md` uses YAML front matter for the token tree and Markdown `<h2>` sections in the order the
format defines:

1. Overview
2. Colors
3. Typography
4. Layout & Spacing
5. Elevation & Depth
6. Shapes
7. Components
8. Do's and Don'ts

An optional `<h1>` title is not needed; `name` in the front matter is the document identity. Section
headings present must be unique, and each top-level token key may appear only once across the file.

## 2. Token strategy: reference palette, theme-owned runtime

The webview is a VS Code webview: every colour resolves from a `--vscode-*` variable, with fixed
literals allowed only as documented exceptions. The DESIGN.md linter rejects `var(...)` as a colour
value, so the token tree cannot hold the runtime expressions directly.

Resolution:

- The `colors` block holds a **Dark Modern reference palette** with concrete CSS colours.
- The Colors prose states that the `--vscode-*` variables are normative at runtime and that the hex
  values exist for agent reasoning and preview tooling, not for copying into CSS.
- A mapping table pairs each token with its source variable and notes which values are fixed
  exceptions (`--container-accent`, `--match-bg`, `--match-hi`, guide fallback, reference fallback).
- Values defined by the VS Code Dark Modern theme file are used verbatim (`editor.background`,
  `editor.foreground`, `focusBorder`, `button.*`, `sideBar.background`, `editorWidget.background`,
  `input.background`, `panel.border`, `descriptionForeground`). Values the theme derives at runtime
  (hover, selection tint, git-decoration rails, diagnostic colours) are stated as rendered reference
  values and labelled as such.

This keeps the document lint-valid without pretending the extension owns a fixed brand palette.

## 3. Colour tokens

| Token | Reference | Source |
|---|---|---|
| `primary` | `#0078D4` | `--vscode-button-background` / `focusBorder` |
| `on-primary` | `#FFFFFF` | `--vscode-button-foreground` |
| `accent` | `#4EC9B0` | fixed container accent |
| `surface` | `#1F1F1F` | `--vscode-editor-background` |
| `surface-chrome` | `#181818` | `--vscode-sideBar-background` |
| `surface-raised` | `#202020` | `--vscode-editorWidget-background` |
| `surface-input` | `#313131` | `--vscode-input-background` |
| `on-surface` | `#CCCCCC` | `--vscode-editor-foreground` |
| `on-surface-muted` | `#9D9D9D` | `--vscode-descriptionForeground` |
| `border` | `#2B2B2B` | `--vscode-panel-border` / `editorGroup-border` |
| `hover` | `#2A2D2E` | `--vscode-list-hoverBackground` (rendered reference) |
| `selection` | `#19252E` | 24% active-selection tint over the editor background |
| `guide` | `#80808040` | `--vscode-tree-indentGuidesStroke` fallback |
| `reference` | `#DCDCAA` | `--vscode-symbolIcon-functionForeground` fallback |
| `match` | `rgba(234, 179, 8, 0.32)` | fixed `--match-bg` |
| `match-active` | `rgba(234, 179, 8, 0.7)` | fixed `--match-hi` |
| `added` | `#81B88B` | `--vscode-gitDecoration-addedResourceForeground` reference |
| `removed` | `#C74E39` | `--vscode-gitDecoration-deletedResourceForeground` reference |
| `changed` | `#E2C08D` | `--vscode-gitDecoration-modifiedResourceForeground` reference |
| `error` | `#F14C4C` | `--vscode-editorError-foreground` reference |
| `warning` | `#CCA700` | `--vscode-editorWarning-foreground` reference |
| `info` | `#3794FF` | `--vscode-editorInfo-foreground` reference |

Every token above is referenced by at least one component, so the linter's `orphaned-tokens` rule is
clean.

## 4. Typography and geometry

| Group | Tokens | Source values |
|---|---|---|
| Typography | `source`, `ui`, `label`, `caption`, `tab` | editor font at `--ecuc-fs` (13px default), 1.55 line height; UI font at 13px / 1.4; labels 12px / 600; captions 11px / 700; tab labels 10px / 700 |
| Rounded | `sm` 2px, `md` 3px, `lg` 4px, `xl` 5px, `full` 9999px | observed radii in component CSS |
| Spacing | `hairline` 1px, `xs` 2px, `sm` 4px, `md` 6px, `lg` 8px, `xl` 12px | observed gaps and paddings |

Layout prose records the fixed geometry: 26px fold gutter, `3ch` document padding, `4ch` indent,
1.55 line height, 26px toolbar, 28px sidebar tab strip, 6px resizer and sashes, 360px default sidebar.

## 5. Component inventory

Components map to classes that exist today:

- Document surface: `document-surface`, `document-row`, `document-row-hover`,
  `document-row-selected`, `container-name`, `row-meta`, `indent-guide`, `reference-target`
- Chrome: `toolbar`, `toolbar-button`, `icon-button`, `primary-button`, `sidebar`,
  `sidebar-tab`, `details-row`
- Search: `search-field`, `search-match`, `search-match-active`
- Diff: `diff-pane`, `pane-divider`, `diff-added-rail`, `diff-removed-rail`, `diff-changed-rail`
- Diagnostics: `diagnostic-error`, `diagnostic-warning`, `diagnostic-info`
- Overlay: `context-menu`

Only the recognized component properties are used: `backgroundColor`, `textColor`, `typography`,
`rounded`, `padding`. Unknown properties would raise warnings.

## 6. Tooling wiring

- No lockfile dependency. The published CLI (`0.4.0`) depends on `zod@^3`, which carries a
  high-severity, dev-only memory-exhaustion advisory (`GHSA-mrhx-c7xc-m3w5`) with no fix in that
  major line; installing it would also add 94 transitive entries to `package-lock.json`.
- Script: `"design:lint": "npx -y -p @google/design.md@0.4.0 designmd lint DESIGN.md"` — a pinned,
  cross-platform invocation. The `designmd` alias avoids the Windows collision between the
  `design.md` bin name and Markdown file associations.
- Lint chain: `"lint": "node eslint-rules/require-escaped-html.test.mjs && eslint src && npm run
  design:lint"`. `npm run compile` (used by CI) and `pretest` both call `lint`, so no workflow edit is
  needed.
- CI result: `npm ci` is unchanged. The first lint run in each job fetches the pinned CLI through
  `npx`; later runs reuse the npm cache.

## 7. Discoverability

- `docs/README.md`: add a table row linking `../DESIGN.md` as the UI design system reference.
- `AGENTS.md`: add a short "Webview design" note after the Trellis block. The note points at
  `DESIGN.md` and the CSS guideline before UI changes. The Trellis-managed block is left untouched.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Theme-derived reference values drift from a future VS Code release | Prose states the variables are normative and the hex values are the Dark Modern reference |
| The format is alpha and may change | Pin the devDependency range and keep the document to the published schema |
| `var()` colours fail validation | Concrete palette only; variables live in prose and the mapping table |
| Orphaned tokens warn | Every colour token is referenced by a component; verified before wiring CI |
| Windows bin-name collision | Script uses `designmd`, per the package documentation |
| `npx` needs registry access | `npm ci` already requires the registry; the pinned version is cached per job |
| Lint adds noise to every compile | The check is file-local and fast; it runs after ESLint |

## 9. Verification

1. `npx -p @google/design.md designmd lint DESIGN.md` → 0 errors, 0 warnings.
2. `npm run design:lint` through the npm script on Windows.
3. `npm run lint`, `npm run compile`, `npm test`.
4. `git diff --stat` confirms only `DESIGN.md`, `package.json`, `package-lock.json`, `docs/README.md`
   and `AGENTS.md` change.
