# Match VS Code fold gutter and clean reference tooltips

## Goal

Move the ECUC Document fold control into a fixed left fold gutter that matches
VS Code/Monaco geometry and iconography, and remove the stray `=` from reference
hover tooltips.

The fold control is currently an inline child of the row, so it moves with each
level's indentation and uses a filled triangle. The target is VS Code's layout:
a fixed 26px fold gutter at the far left, a 16px Codicon outline chevron inset by
2px, and document text starting after the gutter. Expanded chevrons follow VS
Code's hover/focus visibility; collapsed chevrons stay visible.

## Scope

**In**

- A fixed 26px fold gutter at the far left of every Document row, with no line
  numbers.
- A 16px outline chevron using the VS Code Codicon geometry, 2px from the gutter's
  left edge.
- Exact VS Code visibility: expanded chevron hidden at rest and shown when the
  tree/gutter is hovered or focused; collapsed chevron always visible.
- Re-align the metadata header, rows, braces, empty state and bracket guides to
  the post-gutter content edge.
- Remove the stray `=` from the followable and unresolved reference tooltips.
- Tests, docs/specs, dark/HC captures and the normal gates.

**Out**

- Line numbers or a line-number gutter.
- A new font asset, icon dependency, service worker, remote load or CSP change.
- Changes to `src/core/**`, the write path, the manifest or dependencies.
- Changing selection, collapse/filter, details editing, follow, virtual scrolling
  or the `.value` direct-child contract.

## Requirements

- **R1 - Fixed VS Code fold gutter.** Every Document row reserves a 26px fold
  gutter at the far left: VS Code's default 10px line-decoration width plus the
  16px folding allowance. No line numbers are added. The gutter is part of the
  row background for hover/selection.
- **R2 - Exact chevron icon and placement.** The control is a 16x16 outline
  chevron using the Codicon `chevron-right` path, inset 2px from the gutter's left
  edge and vertically centred on the row. Expanded containers rotate the same
  path 90 degrees to a down chevron; collapsed containers show the right chevron.
- **R3 - VS Code visibility.** Expanded chevrons are hidden at rest, shown while
  the tree is hovered or has focus (and while the row itself is hovered/focused).
  Collapsed chevrons are always visible. The control has a full row-height hit
  area and toggles without moving selection.
- **R4 - Alignment.** The metadata header, row text, braces, empty state and
  bracket guides all move right by the 26px gutter. Labels and braces share the
  same indentation; brace rows no longer add the old inline-twisty 3ch offset.
  The document remains horizontally scrollable with `white-space: pre`.
- **R5 - Clean reference tooltips.** A followable reference shows
  `Follow to the target: <target>`. An unresolved reference shows
  `Target not found in this file: <target>`. Neither title includes `=` or any
  other display punctuation. Parameter value titles are unchanged.
- **R6 - Preserve the Document surface.** Click/F2/Enter details editing, row
  selection, collapse/filter, focus/roving tabindex, reveal/follow, re-scan,
  virtual scrolling, `.value` as a direct `.row` child, dark/HC styling and the
  details panel keep their current behavior.
- **R7 - Verification.** Page/geometry tests, tooltip tests, interaction tests,
  updated docs/specs, dark/HC captures and the full gates. No core, manifest or
  dependency changes.

## Acceptance Criteria

- [x] **AC1** Every row reserves the same 26px left fold gutter; the chevron is
  16px, inset 2px, and all container chevrons share the same x-position.
- [x] **AC2** The chevron matches the Codicon outline `>` shape; expanded rotates
  to `v`; expanded is hidden at rest and appears on tree hover/focus; collapsed is
  always visible; the hit area spans the row height.
- [x] **AC3** Metadata, rows, braces, empty state and bracket guides are aligned
  to the post-gutter content edge; no line numbers appear; braces no longer carry
  the inline-twisty offset.
- [x] **AC4** Followable and unresolved reference tooltips contain the target
  text without a leading `=` or other display punctuation.
- [x] **AC5** Existing interactions and gates pass: `check-types`, `lint`,
  `test`, `preview:check`; dark/HC/narrow/deep captures show the gutter and icon.
- [x] **AC6** `src/core/**`, the write path, manifest and dependencies are
  untouched.

## Reference evidence

- VS Code `editorOptions.ts`: `lineDecorationsWidth` defaults to 10px and adds
  16px when folding controls are shown, giving a 26px fold gutter.
- VS Code `folding.css`: fold icons use a 2px left margin and opacity
  transitions; expanded icons appear on margin hover, collapsed icons are always
  visible.
- VS Code `foldingDecorations.ts`: expanded uses the down chevron, collapsed the
  right chevron.
- `vscode-codicons` `chevron-right.svg` supplies the 16x16 outline path.

## Constraints

- No icon font or asset file: inline the Codicon SVG path with an MIT attribution
  comment.
- Keep the existing CSP, inline SVG and CSS-variable model; no inline style
  attributes.
- Dark is the supported theme; high contrast remains the accessibility variant.
- The task is lightweight: PRD-only planning is intentional.
