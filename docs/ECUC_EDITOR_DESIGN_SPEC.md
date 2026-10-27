# ECUC Editor Design Spec

**Status:** ready for implementation review. **Prototype:** `ecuc-editor-prototype.html` (same folder; place both in `docs/design/`).
**Scope:** presentation only. The information model, interactions, DOM contracts, `src/core/**`, the write path and the manifest do not change.

---

## 1. Direction and principles

**Direction: "quiet source".** The Document view should read like a source file that happens to be interactive. At rest it is one monospace surface on the editor background: a dim gutter of real source line numbers, indentation, braces, and a sparse set of semantic colours. Everything interactive (fold controls, edit hint, follow hint, selection) is revealed by hover, focus or selection and never occupies space at rest. Chrome shrinks to a single 26px strip in the UI font, so the eye separates "tool" from "document" by typeface and not by boxes.

The ARTEXT reference already gets the hard part right: one baseline, a gutter that gives the text a left edge, neutral names, colour only on tokens. This spec keeps all of that and adds what a static file cannot have: selection, focus, folding, editing and reference-follow, each expressed as a background tint, a gutter marker or hover-only decoration. No chips, borders, underlines or list bars at rest.

**Principles**

1. **One surface.** Everything sits on `--vscode-editor-background`. Separation is by typeface, hairline or spacing, never by filled boxes.
2. **Position before colour.** Hierarchy comes from indentation, braces and `key = value` structure. Colour marks token meaning only: keyword, string, number, boolean, variant/condition, comment.
3. **Reveal on demand.** Affordances (fold chevrons, edit hint, follow underline) appear on hover, focus or selection. Collapsed state is the one exception and is always visible.
4. **Selection never recolours syntax.** Selection is a background tint plus a gutter number change. Token colours stay.
5. **Honest gutter.** Line numbers are the real ARXML source lines, the same line "Reveal in source" jumps to. Nothing is numbered that is not a file line.
6. **Chrome yields to content.** One 26px strip, text-first, same background as the document.

### Resolving "readable text vs interactive tree"

The text look is the resting state; the tree behaviour is the interaction layer on top. A user who never hovers sees a source file. A user who hovers sees fold controls and a pointer on targets. A user who selects sees a tinted line and a brighter line number.

### ARTEXT comparison

| Aspect | ARTEXT reference | This design |
|---|---|---|
| Surface | One text surface, line gutter | Same |
| Line numbers | Continuous 1..N | Real ARXML source line of each entity (non-continuous; braces and header lines unnumbered) |
| Indent | 4 spaces | 4ch |
| Structural names | Teal / yellow / light | Neutral by default; one optional restrained accent for parameter/reference labels (decision D1) |
| Keywords, booleans | Blue | Blue (`debugTokenExpression-boolean`) |
| Strings, short names | Orange | Orange (`debugTokenExpression-string`) |
| Numbers, hex, schema release | Green | Green (`debugTokenExpression-number`) |
| Variant, conditions | Purple | Purple (`debugTokenExpression-name`) |
| Comments / annotations | Green italic | Green italic (mixed toward background) |
| Reference targets | Plain text | Plain text; underline only on hover |
| Collapse | n/a | `{ … }` stub when folded; chevron in gutter on hover |
| Selection | n/a | Tinted line, brighter line number, gutter rail on focus |

---

## 2. Shell and layout

### 2.1 Shell

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⌕ Filter…                12 of 340     ⊟ ⊞   Document | Tree   Details │ ← strip, 26px, UI font
├───────────────────────────────────────────────────┬──────────────────┤
│  gutter │ document (mono, scrolls both ways)      │ details (optional)│
│   ln fold                                          │ 260–340px         │
└───────────────────────────────────────────────────┴──────────────────┘
```

**Strip (answers open question 1).** A single 26px row, background equal to the editor, UI font 12px, muted text, 1px bottom hairline (`--vscode-editorGroup-border`).

- Left: filter input, flex `0 1 28ch`, transparent at rest, `--vscode-input-background` when non-empty, `--vscode-focusBorder` outline on focus. Placeholder `Filter`. The count (`12 of 340`) sits to its right in muted text and only renders while a filter is active.
- Right: two icon buttons (collapse all, expand all, inline SVG, `currentColor`, `aria-label` + `title`), then a two-state text switch `Document | Tree` (active segment in `--vscode-foreground`, inactive muted, `aria-pressed`), then a `Details` toggle button (`aria-pressed`).
- Buttons: transparent, no border, 20px high, `--vscode-toolbar-hoverBackground` on hover, 2px radius.
- Optional, additive and low risk: `/` and `Ctrl+F` focus the filter. This is a new key binding, so it needs requester approval (D5).

A bottom status bar was rejected: it would stack on VS Code's own status bar and move the filter away from the first line. Auto-hide was rejected because it hides the filter.

### 2.2 Document surface

Gutter anatomy (left to right):

```
| line number (right-aligned) | 1ch | fold column 2ch | 1ch | text …
|          --ln-w             |            --gut = --ln-w + 4ch          |
```

- `--ln-w` = `calc(var(--ln-digits, 4) * 1ch + 1ch)`. `renderTree` sets `--ln-digits` once on `#tree` from the largest source line number's digit count.
- Line numbers: `--vscode-editorLineNumber-foreground`; selected row uses `--vscode-editorLineNumber-activeForeground`.
- Fold column holds the existing `.twisty` / `.spacer`. Expanded chevrons are visible only while the pointer is over `#tree` or focus is inside it. **Collapsed chevrons are always visible.**
- A collapsed container shows a stub after its line: `{ … }` in the muted punctuation colour, so a fold is readable without hover.
- Braces: `{` on its own line aligned with the parent, `}` aligned likewise; muted punctuation colour; unnumbered (existing pseudo-elements).
- Header lines (`schema`, `package`) are unnumbered. One blank line (one row height) separates the header from the first module and separates sibling modules. There are no blank lines between containers.
- Padding: top `0.5 × line-height`, right `2ch`, bottom `3 × line-height` so the last line can scroll away from the edge. No left padding: the gutter supplies it.
- Long lines: horizontal scroll, `white-space: pre`, no wrap, no truncation. `scroll-padding-left: var(--gut)` so keyboard focus never lands under the gutter.
- Wide screens: left-aligned, no max-width (source files are left-aligned).

**Open question 2 (line numbers).** Yes, show them, but as source line numbers (`data-line` on `.row`, rendered with `::before { content: attr(data-line) }`). This adds one attribute per row and zero elements. It is the only structural change the gutter needs. Gaps between numbers read like folded code, which is accurate.

### 2.3 Details panel (questions 9)

- Docked on the right, hidden by default, squeezes the document. Width `clamp(260px, 30%, 340px)`. Left edge is a 1px `--vscode-editorGroup-border`. Background equals the editor.
- Content is stacked key over value (long `DEFINITION-REF` paths need the width): key 11px UI font, muted; value in the editor font at the document size, `overflow-wrap: anywhere`, normal white-space.
- Order is unchanged: kind, primary label, full `DEFINITION-REF`, short name/variant, value/hex, target/context, conditions, annotations, source range.
- Actions: three flat text buttons (`Reveal in source`, `Copy path`, `Copy value`) at the bottom, same style as strip buttons; keep existing handlers.
- Empty state: one muted line, `Select a line to see its details.`, plus a second muted line `Click a line or press Space.`
- At ≤720px the panel becomes a bottom sheet: full width, max-height `45vh`, top hairline, document stays visible above.

### 2.4 Tree view (question 10)

Keep as the technical view, with the **surface aligned** and the **structure unchanged**.

Aligned: strip, typography family and size, shared `--tok-*` tokens for values, selection / hover / focus treatment, details panel, empty state, reference targets plain until hover (replaces the permanent blue underline).
Unchanged: two-line grid, 26ch label column, chips, per-kind glyphs and accent borders, dotted value underline (it is the Tree view's editability cue because the Tree has no hover gutter).

### 2.5 Widths

- ≤720px: see section 7.
- Very wide: no change. The document stays left-aligned; the details panel stays 340px at most.

---

## 3. Typography and spacing

| Item | Value |
|---|---|
| Document font | `var(--vscode-editor-font-family, monospace)` |
| Size | `var(--vscode-editor-font-size, 13px)` (follows the user's editor setting; 13px fallback) |
| Weight | `var(--vscode-editor-font-weight, normal)` |
| Ligatures | off: `font-variant-ligatures: none` (so `==` and `&&` render as typed) |
| Line height | `calc(var(--ecuc-fs) * 1.55)` = about 20px at 13px; rows have no vertical padding or margin |
| Indent | `4ch` per level (matches the reference) |
| Tab size | `tab-size: 4` |
| Strip and details chrome | `var(--vscode-font-family)`, 12px; details keys 11px |
| Letter spacing | normal |

Alignment rules

- A line reads left to right: `label`, then metadata or `=`. No label column in Document view.
- Parameter: `Label = value (= 0x3F)`. Reference: `Label = target context ctx`. Container: `Label "short" /* note */`. Module: `module path "short" (variant) [cond] <criteria> /* note */`.
- `=` is a muted-punctuation separator with one space each side. It is never underlined.
- Hex form renders as `(= 0x3F)`: parentheses muted, number in the number colour.
- `context` is a keyword (blue). Conditions use the variant/condition colour. Annotations use comment style (italic).
- Six levels deep: `6 × 4ch = 24ch` of indent after the gutter. The gutter is fixed width, so deep rows never shift it. Indent guides stay at every 4ch.

Density for a 12k-node file: 13px / 1.55 is about 20px per row, about 45 rows on a 900px editor. It is dense enough for scanning and does not rely on virtualisation.

---

## 4. Colour and token system

All colours are `--vscode-*` variables with a fallback inside `var(...)`. Fallbacks resolve to the editor foreground so that a theme missing a variable degrades to monochrome, never to an invented colour. The only literal remains the existing indent-guide fallback.

```css
body[data-view] {
  --ecuc-fs: var(--vscode-editor-font-size, 13px);
  --ecuc-lh: calc(var(--ecuc-fs) * 1.55);

  /* syntax tokens */
  --tok-keyword: var(--vscode-debugTokenExpression-boolean, var(--vscode-editor-foreground));
  --tok-string:  var(--vscode-debugTokenExpression-string,  var(--vscode-editor-foreground));
  --tok-number:  var(--vscode-debugTokenExpression-number,  var(--vscode-editor-foreground));
  --tok-meta:    var(--vscode-debugTokenExpression-name,    var(--vscode-editor-foreground));
  --tok-comment: color-mix(in srgb,
                   var(--vscode-charts-green, var(--vscode-editor-foreground)) 85%,
                   var(--vscode-editor-background));
  --tok-key:     var(--vscode-symbolIcon-variableForeground, var(--vscode-editor-foreground)); /* decision D1 */
  --tok-punct:   color-mix(in srgb, var(--vscode-editor-foreground) 70%, var(--vscode-editor-background));
  --tok-dim:     color-mix(in srgb, var(--vscode-editor-foreground) 55%, var(--vscode-editor-background));

  /* states */
  --hover-bg: var(--vscode-list-hoverBackground, transparent);
  --sel-bg:   var(--vscode-list-inactiveSelectionBackground, var(--vscode-editor-lineHighlightBackground, transparent));
  --sel-bg-focus: color-mix(in srgb,
                    var(--vscode-list-activeSelectionBackground, var(--vscode-list-inactiveSelectionBackground, transparent)) 45%,
                    transparent);
  --rail: var(--vscode-focusBorder, var(--vscode-editorCursor-foreground));
}
```

### Token mapping

| Token | Variable | Applies to | Expected look (default themes) |
|---|---|---|---|
| Keyword | `--tok-keyword` | `schema`, `package`, `module`, `context`, boolean values | blue |
| String | `--tok-string` | short names, string values | orange (dark) / dark red (light) |
| Number | `--tok-number` | numbers, hex, schema release | green |
| Meta | `--tok-meta` | `(variant)`, `[SW-SYSCOND]`, `<criteria>` | purple |
| Comment | `--tok-comment` | annotations | green, italic |
| Key (D1) | `--tok-key` | parameter and reference labels only | light blue |
| Punctuation | `--tok-punct` | `=`, braces, parentheses, `{ … }` stub | muted foreground |
| Dim | `--tok-dim` | strip text, details keys, hints | more muted foreground |
| Neutral | `--vscode-editor-foreground` | module path, container labels, reference targets, context path | foreground |

These variables mirror what the default themes use for the matching syntax categories, but they are not guaranteed identical in every theme. Confirm the actual resolution in an Extension Development Host (dark, light, high contrast and one custom theme).

**Per-kind colours (question 4).** None. Kind is recognised by line shape (`module` keyword, `label "short" {`, `label = value`, `label = target`). The Tree view keeps its glyphs.

**Accent count.** Five syntax accents (keyword, string, number, meta, comment) plus the optional key accent. The key accent is the single colour on structure and exists because `key = value` scanning is the main reading axis. If the requester prefers strictly neutral labels, set `--tok-key` to the foreground and nothing else changes.

### State colours

| State | Dark / Light | High contrast |
|---|---|---|
| Hover (row) | `--hover-bg` | `outline: 1px dashed var(--vscode-contrastBorder)` |
| Selected, unfocused | `--sel-bg` | `outline: 1px solid var(--vscode-contrastBorder)` |
| Selected, focused | `--sel-bg-focus` + gutter rail | `outline: 1px solid var(--vscode-contrastActiveBorder, var(--vscode-focusBorder))` |
| Focus-visible | 2px gutter rail in `--rail` | same outline, 2px |
| Editing | `--vscode-input-background`, 1px `--vscode-focusBorder` outline | same, outline 2px |
| Invalid | outline `--vscode-inputValidation-errorBorder`; reason in `--vscode-errorForeground` | same, plus the reason text (colour is never the only cue) |
| Filter match | `--vscode-editor-findMatchHighlightBackground` on matched ranges | `outline: 1px solid var(--vscode-contrastActiveBorder)` |
| Follow / reveal flash | `--vscode-editor-findMatchHighlightBackground`, 1s fade | static outline for 1s |

**Selected-line rule.** Syntax colours are kept on the selected line. Because tints are translucent over the editor background, token contrast only changes slightly. Rule: selection tint opacity stays at or below the values above; in high contrast no fill is used at all. Verify keyword blue, string orange and number green at ≥ 4.5:1 against the selected background in the default dark and light themes.

**Contrast targets.** Body text and tokens ≥ 4.5:1. Line numbers and hints ≥ 3:1 (they duplicate information available elsewhere). Hover and selection fills do not carry meaning alone.

---

## 5. Components and states

### Components

| Component | Rendering |
|---|---|
| Strip | 26px, UI font, editor background, bottom hairline |
| Filter field | transparent at rest; input background when non-empty; focus outline; clear button (×, inline SVG) appears when non-empty |
| Count | muted, `12 of 340`, only while filtering |
| Notice | one muted line under the strip (existing role) |
| Module line | `module` keyword, neutral dotted path, string short name, meta variant/condition, comment annotation |
| Container line | neutral label, string short name, comment annotation, `{` on the next line |
| Parameter line | `--tok-key` label (D1), `=`, value coloured by `data-value-kind`, hex in parentheses |
| Reference line | `--tok-key` label (D1), `=`, neutral target, `context` keyword, neutral context path |
| Short name | `"ShortName"` in string colour |
| Variant | `(Variant)` in meta colour |
| Hex | `(= 0x3F)` |
| Context | keyword `context` + neutral path |
| Condition | `[SW-SYSCOND]` / `<criterion == value && …>` in meta colour |
| Annotation | `/* [Label] text */` italic comment colour |
| Gutter twisty | chevron in fold column; hover-revealed when expanded; always visible when collapsed |
| Reference target | neutral plain text; hover: underline (1px, offset 3px) in `--vscode-textLink-foreground`, `cursor: pointer` |
| Details inspector | section 2.3 |
| Tree rows and chips | section 2.4 |
| Empty filter state | a comment-style line in the document area, see below |

**Empty filter state.** Render in the document area as a source comment, left-aligned at text start with an empty gutter: `/* No entities match "xyz". */` in comment style, followed by a flat `Clear filter` button. This keeps the empty state inside the "source file" language.

**Other edge states**

- No ECUC values: unchanged, falls back to the text editor before any HTML.
- Very long label: no truncation; horizontal scroll.
- Missing variant or annotation: the token and its leading space are omitted (no empty parentheses).
- CDATA-refused editing: edit is refused as today; reason shows in the invalid style (see below).

### State matrix (Document view)

| State | What changes | Must not change |
|---|---|---|
| Default | Text as in section 3 and 4 | No borders, underlines or chips |
| Hover (row) | `--hover-bg` on the full row | Text colours, layout |
| Hover (value) | `cursor: text`; faint `--vscode-toolbar-hoverBackground` behind the value only, 2px radius | No dotted underline, no pencil |
| Hover (target) | Underline in `--vscode-textLink-foreground`, pointer | Target text colour stays neutral |
| Focus-visible | 2px `--rail` at the gutter edge; line number to active colour; HC outline | Selection state |
| Selected | `--sel-bg` (or `--sel-bg-focus` when the tree has focus); active line number | Token colours |
| Selected + editable | Muted trailing hint `F2` after the line (comment style, `--tok-dim`) | The hint is `aria-hidden` and never selectable text |
| Editing | Value becomes the input: input background, focus outline, same font, `padding: 0 0.5ch` | Row height, other lines |
| Invalid | Error outline; refused text kept; reason as trailing comment-style text in error colour: `/* must be 0..255 */` | Typed text, focus |
| Collapsed | Chevron always visible; `{ … }` stub; children and closing brace hidden | Row position, line number |
| Filtered (match) | Match ranges highlighted | Ancestors of matches remain visible |
| Filtered (empty) | Empty comment line | Filter text, count |
| Follow / reveal | Brief flash on the destination line | Selection, scroll restore |

---

## 6. Interaction and accessibility

- **Selection, focus, hover, editing** are communicated by tint, gutter rail, line-number brightness and the input chrome. No list bars, no underlines at rest.
- **Keyboard focus** is always visible: 2px gutter rail plus line-number change; high contrast adds a full 2px outline. Roving `tabindex` and all existing keys are unchanged.
- **Roles and ARIA** are unchanged: `tree` / `treeitem` / `group`, `aria-level`, `aria-expanded`, `aria-selected`, `aria-posinset`, `aria-setsize`. The gutter numbers, `{ … }` stub and `F2` hint are decorative (`aria-hidden` or generated content); the accessible name stays the existing label and value.
- **Collapse/expand discoverability** (no permanent twisty column): collapsed rows always show a chevron and `{ … }`; expanded chevrons appear on pointer-over and focus-within; `Enter` toggles; the strip has collapse-all and expand-all.
- **Editability discoverability** (no underline or pencil): value hover cursor and faint background; `F2` hint on the selected parameter line. If a read-only marker already exists in the model (for example CDATA), suppress the hint there; otherwise show it on all parameter lines and let the refusal explain.
- **Reference-follow discoverability** (no permanent blue): hover underline and pointer; keep the existing `title`. Click behaviour is unchanged.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` replaces the 1s fade with a stepped 1s highlight (`animation: flash 1s steps(1, end)`); no other animation exists.
- **High contrast:** no fills; outlines only; no colour-only cues (keys vs values are distinguished by position and `=`; annotations by italics and delimiters; errors by text).

---

## 7. Responsive and density

**≤720px** (`@media (max-width: 720px)`):

- Line numbers hidden; fold column kept; `--gut: 3ch`.
- Indent `3ch` per level.
- Strip: filter takes the remaining width; count hidden; collapse/expand and Details become icon-only (labels hidden, `aria-label` kept); `Document | Tree` stays as text.
- Details opens as a bottom sheet (section 2.3).
- Horizontal scroll remains the long-line strategy.

**Long lines (question 12).** Horizontal scroll, matching the reference. A soft-wrap toggle is out of scope: it interacts with indentation, the gutter and the inline editor and needs its own design. A later wrap mode would have to hang-indent wrapped lines to the value column and keep the editor input unwrapped.

**Density (question 11).** 13px, line-height 1.55, 4ch indent. Revisit only if the Extension Development Host shows crowding at 12k nodes.

---

## 8. Implementation mapping

### Markup changes (the full list)

1. `.row` gets `data-line="<1-based source line>"`, computed from the node's source range start via `lineIndex`. Use the same line `Reveal in source` jumps to. Header (`.meta`) and braces get none.
2. `#tree` gets `style="--ln-digits:N"`.
3. Strip: regroup existing `.toolbar` children into the order in section 2.1 and replace text `Collapse` / `Expand` labels with the two inline-SVG icon buttons (keeping their ids and handlers). No new ids.

No new state, attributes beyond `data-line`, scripts or event listeners. The `F2` hint, `{ … }` stub and gutter numbers are generated content.

### CSS mapping (all scoped under `body[data-view="document"]` unless noted)

| Selector | Change |
|---|---|
| `body[data-view]` | Add the token block from section 4 |
| `#tree` | `position: relative`; `--ln-w`, `--gut`; padding per 2.2; `font` per section 3; `white-space: pre`; `scroll-padding-left: var(--gut)` |
| `.row` | `padding-inline-start` unchanged mechanism (nested `.children`); do not make `.row` positioned |
| `.row::before` | `content: attr(data-line)`; `position: absolute; left: 0; width: var(--ln-w); text-align: right; color: var(--vscode-editorLineNumber-foreground, var(--tok-dim))` (vertical position stays static, so no `top`) |
| `.row[data-selected]::before` | active line-number colour |
| `.twisty`, `.spacer` | Position into the fold column: `left: calc(var(--ln-w) + 1ch)`; `#tree:not(:hover):not(:focus-within) [aria-expanded="true"] > .row .twisty { opacity: 0 }` |
| `[aria-expanded="false"] > .row::after` | `content: " { … }"; color: var(--tok-punct)` |
| `.label` | neutral; for `[data-kind="parameter"] .label, [data-kind="reference"] .label { color: var(--tok-key) }` (D1) |
| `.short`, `.variant`, `.condition`, `.annotation`, `.hex`, `.context`, `.target` | map to section 4 tokens; annotation `font-style: italic` |
| `.target:hover` | underline, `--vscode-textLink-foreground`, pointer; remove any permanent underline |
| `.row:hover` | `background: var(--hover-bg)` |
| `.row[data-selected]` | `background: var(--sel-bg)`; `#tree:focus-within .row[data-selected]` uses `--sel-bg-focus`; remove the monochrome-foreground rule |
| `.row:focus-visible` | `box-shadow: inset 2px 0 0 var(--rail)`; keep any existing mechanism that extends the highlight to the gutter edge across nested `.children` |
| `.toolbar` (+ children) | strip per 2.1: 26px, UI font, transparent buttons, hairline |
| `.filter` | width `0 1 28ch`; transparent at rest |
| `#inspector` | per 2.3 |
| `@media (max-width: 720px)` | per section 7 |
| `@media (prefers-reduced-motion: reduce)` | stepped flash |
| `@media (forced-colors: active), body.vscode-high-contrast` | outlines instead of fills |

### Rules to remove or replace

- The 3.5ch empty gutter and its hover-twisty rule (replaced by the computed gutter).
- The selected-row monochrome foreground rule.
- The strip's `3px` padding, `240px` filter width and any border or background on `.tool` at rest.
- Any permanent target underline or colour in Document view (Tree view: hover-only as well).

### Does not change

- DOM contracts: `.value` is a direct child of `.row`; value-widget listeners registered first with `stopImmediatePropagation`; `.row-meta` is the single source for the inspector; node ids and `matchRanges` stable.
- State keys `{ view, inspectorHidden }`, defaults Document and hidden.
- All interactions and shortcuts in section 4 of the brief; accessibility roles and attributes.
- One DOM, two views; no second renderer; no virtualisation.
- `src/core/**`, the write path, the manifest and its `priority`; no new dependency, asset, font or remote load; no `.artext` parsing.
- Information shown: every field remains visible and searchable.

### Performance

One attribute per row, one custom property on `#tree`, and generated content. No per-row elements, no JS layout. `color-mix` is evaluated on custom properties once per body, not per row. Harness samples (4,001 and 12,001 nodes) should load as today.

### Risks

| Risk | Mitigation |
|---|---|
| `color-mix()` needs Chromium ≥ 111 | Confirm `engines.vscode` (the README assumes 1.85 or later). Fallback: define `--tok-comment`, `--tok-punct`, `--tok-dim` as plain variables if an older host must be supported |
| Gutter numbers scroll away under horizontal scroll | Acceptable in v1; v2 can pin with a sticky gutter wrapper |
| Absolute `::before` assumes `.row` and its ancestors up to `#tree` are not positioned | Verify existing focus-edge and highlight mechanisms; if `.row` is already positioned, anchor the number with `inset-inline-start` against a sticky pseudo-element on `.children` instead |
| Token variables differ across themes | Check four themes in an Extension Development Host; fall back to neutral per token if a theme looks wrong |
| Selected tint reduces token contrast | Keep opacities as specified; test default dark and light |
| `Ctrl+F` / `/` conflict with VS Code or the webview | Decision D5; test in an Extension Development Host |

### Implementation order

1. Token block and typography (no layout change).
2. `data-line`, `--ln-digits`, gutter, fold column, collapsed stub.
3. Hover / selected / focus / HC states.
4. Strip and filter restyle; empty-state comment.
5. Editing and invalid presentation.
6. Details panel restyle and bottom sheet.
7. Narrow width.
8. Tree view surface alignment.
9. Update document tests and harness captures; run `check-types`, `lint`, `test`, `preview:check`.
10. Extension Development Host pass: themes, fonts, focus, clipboard.

### Verifiable in the harness vs needs a real Extension Development Host

Harness: layout, gutter alignment, states via forced classes, narrow width, three theme presets, 12k-node load.
Real host: actual `--vscode-*` resolution per theme, editor font metrics and `editor.fontSize` follow, focus and keyboard behaviour, clipboard, `forced-colors` handling.

---

## 9. Open questions and decisions

| # | Question | Recommendation |
|---|---|---|
| 1 | Toolbar | Slim 26px top strip in UI font; no bottom bar, no auto-hide. Filter always visible |
| 2 | Line numbers | Yes, as real source line numbers via `data-line`; unnumbered braces and header |
| 3 | Gutter without numbers | Not needed; gutter = number + fold column. On ≤720px the fold column remains |
| 4 | Colour count | Five syntax accents plus one optional key accent; no per-kind colours |
| 5 | Selection | Full-row tint, syntax colours kept, brighter line number |
| 6 | Focus | 2px gutter rail (caret-like) plus HC outline |
| 7 | Editability | Hover cursor and faint value background; `F2` hint on the selected parameter line |
| 8 | Reference follow | Hover underline and pointer; neutral at rest |
| 9 | Details | Docked right panel (squeezes); bottom sheet at ≤720px |
| 10 | Tree view | Keep; align surface, keep structure |
| 11 | Density | 13px (follows editor setting), 1.55, 4ch |
| 12 | Long lines | Horizontal scroll; wrap deferred |
| 13 | Conditions / annotations | Comment-style (annotations italic green) and meta-coloured conditions; no chips in Document view |
| 14 | Edge states | Empty filter as a source-comment line; missing tokens omitted; refusal reason as error-coloured trailing comment |
| 15 | Icons vs text | Icons for collapse/expand all and filter clear; text for view switch and Details (state must be readable) |

### Decisions needing requester approval before coding

- **D1:** keep the single key accent on parameter and reference labels, or go fully neutral (one variable).
- **D2:** show real source line numbers in the gutter (adds `data-line`).
- **D3:** the `F2` hint on the selected parameter line.
- **D4:** Tree view surface alignment (hover-only target underline; dotted values and chips unchanged).
- **D5:** optional `/` and `Ctrl+F` to focus the filter.

---

## 10. Acceptance checklist

- [ ] Document, Tree, strip, details panel and ≤720px are all specified.
- [ ] Every state in the matrix has exact values for dark, light and high contrast.
- [ ] All colours are `--vscode-*` variables with in-`var()` fallbacks; no new literal.
- [ ] Type sizes, line height, indent, alignment and spacing are exact.
- [ ] Every component maps to an existing selector or a listed markup change.
- [ ] DOM contracts, state keys, interactions and accessibility are preserved.
- [ ] No new dependency, asset, font, remote load, `.artext` parsing or core change.
- [ ] Prototype covers dark, light, high contrast, selected, editing + invalid, Tree, details empty/selected and narrow.
- [ ] All 15 open questions are answered; five decisions are flagged.
- [ ] "Does not change" and risk lists are present.
- [ ] Extension Development Host checks are listed.
