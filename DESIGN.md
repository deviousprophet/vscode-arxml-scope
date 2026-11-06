---
name: ARXML Scope
description: A quiet, editor-native document and diff surface for AUTOSAR ECUC files.
colors:
  primary: "#0078D4"
  on-primary: "#FFFFFF"
  accent: "#4EC9B0"
  surface: "#1F1F1F"
  surface-chrome: "#181818"
  surface-raised: "#202020"
  surface-input: "#313131"
  on-surface: "#CCCCCC"
  on-surface-muted: "#9D9D9D"
  border: "#2B2B2B"
  hover: "#2A2D2E"
  selection: "#19252E"
  guide: "#80808040"
  reference: "#DCDCAA"
  match: "rgba(234, 179, 8, 0.32)"
  match-active: "rgba(234, 179, 8, 0.7)"
  added: "#81B88B"
  removed: "#C74E39"
  changed: "#E2C08D"
  error: "#F14C4C"
  warning: "#CCA700"
  info: "#3794FF"
typography:
  source:
    fontFamily: "var(--vscode-editor-font-family, Consolas, 'Courier New', monospace)"
    fontSize: 13px
    fontWeight: "400"
    lineHeight: 1.55
  ui:
    fontFamily: "var(--vscode-font-family, -apple-system, 'Segoe UI', sans-serif)"
    fontSize: 13px
    fontWeight: "400"
    lineHeight: 1.4
  label:
    fontFamily: "var(--vscode-font-family, -apple-system, 'Segoe UI', sans-serif)"
    fontSize: 12px
    fontWeight: "600"
    lineHeight: 1.4
  caption:
    fontFamily: "var(--vscode-font-family, -apple-system, 'Segoe UI', sans-serif)"
    fontSize: 11px
    fontWeight: "700"
    lineHeight: 1.4
  tab:
    fontFamily: "var(--vscode-font-family, -apple-system, 'Segoe UI', sans-serif)"
    fontSize: 10px
    fontWeight: "700"
    lineHeight: 1.4
rounded:
  sm: 2px
  md: 3px
  lg: 4px
  xl: 5px
  full: 9999px
spacing:
  hairline: 1px
  xs: 2px
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
components:
  document-surface:
    backgroundColor: "{colors.surface}"
  document-row:
    textColor: "{colors.on-surface}"
    typography: "{typography.source}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs}"
  document-row-hover:
    backgroundColor: "{colors.hover}"
  document-row-selected:
    backgroundColor: "{colors.selection}"
  container-name:
    textColor: "{colors.accent}"
    typography: "{typography.source}"
  row-meta:
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.caption}"
  indent-guide:
    backgroundColor: "{colors.guide}"
  reference-target:
    textColor: "{colors.reference}"
  search-field:
    backgroundColor: "{colors.surface-input}"
    textColor: "{colors.on-surface}"
    typography: "{typography.ui}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  search-match:
    backgroundColor: "{colors.match}"
  search-match-active:
    backgroundColor: "{colors.match-active}"
  toolbar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label}"
  toolbar-button:
    textColor: "{colors.on-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs}"
  icon-button:
    textColor: "{colors.on-surface}"
    rounded: "{rounded.full}"
    padding: "{spacing.xs}"
  primary-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  sidebar:
    backgroundColor: "{colors.surface-chrome}"
    rounded: "{rounded.lg}"
  sidebar-tab:
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.tab}"
    rounded: "{rounded.md}"
    padding: "{spacing.xs}"
  details-row:
    textColor: "{colors.on-surface}"
    typography: "{typography.caption}"
    padding: "{spacing.xs}"
  context-menu:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    typography: "{typography.ui}"
    rounded: "{rounded.xl}"
    padding: "{spacing.sm}"
  pane-divider:
    backgroundColor: "{colors.border}"
  diff-pane:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
  diff-added-rail:
    backgroundColor: "{colors.added}"
  diff-removed-rail:
    backgroundColor: "{colors.removed}"
  diff-changed-rail:
    backgroundColor: "{colors.changed}"
  diagnostic-error:
    textColor: "{colors.error}"
  diagnostic-warning:
    textColor: "{colors.warning}"
  diagnostic-info:
    textColor: "{colors.info}"
---

## Overview

ARXML Scope is a VS Code extension, and its webview reads as part of the editor rather than as a
separate application. The identity is **quiet source**: dense monospace rows, flat tonal layers,
hairline borders and almost no decorative chrome. Hierarchy comes from indentation, weight and tone,
not from colour or shadow.

The surface must stay legible in every host theme, including high contrast and forced colours. The
tokens below describe the Dark Modern reference the UI was tuned against; the `--vscode-*` variables
remain the runtime source of truth.

## Colors

The palette has three jobs:

- **Host surfaces and text** carry almost the whole interface. Backgrounds, foregrounds, borders,
  inputs and the focus ring all come from theme variables.
- **Fixed semantic accents** are the documented exceptions where a theme variable would erase meaning:
  the container teal, the two amber search tiers, the reference yellow and the indent-guide grey.
- **Diff and diagnostics** use theme diff and editor colours so status always matches the host.

| Token | Source | Notes |
|---|---|---|
| `primary` | `--vscode-button-background`, `--vscode-focusBorder` | Action and focus |
| `on-primary` | `--vscode-button-foreground` | Text on the action colour |
| `accent` | `--container-accent` | Fixed `#4EC9B0` for ECUC container names |
| `surface` | `--vscode-editor-background` | Document and diff surface |
| `surface-chrome` | `--vscode-sideBar-background` | Sidebar and chrome |
| `surface-raised` | `--vscode-editorWidget-background` | Menus and raised widgets |
| `surface-input` | `--vscode-input-background` | Search and edit fields |
| `on-surface` | `--vscode-editor-foreground` | Primary text |
| `on-surface-muted` | `--vscode-descriptionForeground` | Meta, hints and captions |
| `border` | `--vscode-panel-border`, `--vscode-editorGroup-border` | Pane split and separators |
| `hover` | `--vscode-list-hoverBackground` | Rendered Dark Modern reference |
| `selection` | 24% active-selection tint over `surface` | Rendered Dark Modern reference |
| `guide` | `--vscode-tree-indentGuidesStroke` fallback | Fixed `#80808040` |
| `reference` | `--vscode-symbolIcon-functionForeground` fallback | Fixed `#DCDCAA` |
| `match` | `--match-bg` | Fixed `rgba(234, 179, 8, 0.32)` |
| `match-active` | `--match-hi` | Fixed `rgba(234, 179, 8, 0.7)` |
| `added` | `--vscode-gitDecoration-addedResourceForeground` | Rendered reference |
| `removed` | `--vscode-gitDecoration-deletedResourceForeground` | Rendered reference |
| `changed` | `--vscode-gitDecoration-modifiedResourceForeground` | Rendered reference |
| `error` | `--vscode-editorError-foreground` | Rendered reference |
| `warning` | `--vscode-editorWarning-foreground` | Rendered reference |
| `info` | `--vscode-editorInfo-foreground` | Rendered reference |

Rules:

- Never hard-code a palette value in component CSS. Use a `--vscode-*` variable or a token from
  `src/webview/styles/tokens.css`. A literal is allowed only as a fallback inside `var(...)`, and only
  when the CSS exception log records it.
- Selection changes the background and adds a 2px rail; it never recolours syntax tokens.
- High contrast and forced colours replace fills with outlines. Keep the token names, change the
  treatment.

## Typography

- **Source rows** use the editor font family at `--ecuc-fs` (host editor size, 13px fallback) with a
  1.55 line height. Ligatures are off, tab size is 4 and whitespace is preserved.
- **Chrome** uses the VS Code UI font at 13px with a 1.4 line height.
- **Labels** are 12px semibold; **tab labels** are 10px bold uppercase; **captions** are 11px bold
  uppercase for section heads and meta keys.
- Values and labels share the monospace grid. UI text never appears inside the row surface.

## Layout & Spacing

- The spacing scale is 4px based: hairline 1px, then 2, 4, 6, 8 and 12px.
- Source geometry: a 26px fold gutter, `3ch` document padding and `4ch` indent per level.
  `--content-pad` is the gutter plus the document padding, and depth is generated from it.
- Chrome: 26px toolbar, 26px search input, 28px sidebar tab strip, 6px resizer and pane sashes.
  The sidebar defaults to 360px. The diff toolbar grows to a 54px minimum so icon-over-label groups
  fit.
- One vertical scroller owns each surface. Horizontal bars are per pane and mirrored in the diff, so
  both panes pan together while the split stays fixed.
- At 720px and below the document narrows its padding to `2.5ch` and its indent to `3ch`, and the
  sidebar moves below the document with a 45vh cap.

## Elevation & Depth

- The interface is flat. Depth is tonal: editor background, raised widget background, input
  background and translucent selection washes.
- Separators are 1px panel or group borders. The diff split is a 3px rule aligned with the pane
  divider.
- Diff status uses 3px inset rails for added, removed and changed rows, plus 1px outlines on changed
  words.
- The context menu is the only raised element with a shadow: `0 4px 14px` using the host
  `--vscode-widget-shadow`. Never use a shadow to signal hover; use the hover background.

## Shapes

- **2px** — rows, compact buttons, inputs and chips.
- **3px** — menus, panes and tabs.
- **4px** — sidebar panels.
- **5px** — the context menu container.
- **50%** — circular icon buttons and count badges.
- The UI is rectilinear: no pills and no large decorative radii.

## Components

### Document surface

The document is one virtualised list of monospace rows. A row is a single flex line with a 26px fold
gutter and indentation from `data-level`. `document-row-hover` and `document-row-selected` are the only
row states that change the background; the selected subtree also tints its descendants. Container
names use the teal accent, references use the yellow fallback, and meta text uses the muted foreground.

### Chrome

The toolbar is a 26px strip with divider-separated groups and 20px-tall tools. The diff toolbar keeps
the icon-over-label variant. Use the shared sidebar button primitives for actions; do not invent a
second button style. The sidebar is a 360px panel with a 28px vertical tab strip and a 22px section
header.

### Search

The search field is a 26px input on `surface-input`. Match marks use the two fixed amber tiers:
`match` for every hit and `match-active` for the current hit. Never use theme find-match colours,
because a theme may resolve them to transparent.

### Diff

Each pane is its own surface inside the shared scroller. Status is a background tint plus a 3px rail:
`added` on the right, `removed` on the left, `changed` on both. Changed words get a 1px outline in the
same colour. Syntax tokens keep their own colours.

### Diagnostics and overlay

Problems and validation messages use the `error`, `warning` and `info` foregrounds without coloured
backgrounds. The context menu is the only raised surface: `surface-raised`, a 5px radius and the host
widget shadow.

## Do's and Don'ts

- **Do** consume a `--vscode-*` variable or a `tokens.css` token for every colour.
- **Do** keep row geometry in the shared custom properties so CSS and the virtual-scroll offsets agree.
- **Do** verify both a light and a dark theme, plus a high-contrast theme.
- **Don't** copy the reference hex values into component CSS; they exist for agent reasoning.
- **Don't** recolour syntax tokens to show selection, search or diff status.
- **Don't** add a shadow, gradient or large radius to signal hierarchy.
