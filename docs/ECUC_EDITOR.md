# ECUC Editor

A VS Code custom editor for ECUC-Values `.arxml` files: it renders the file as a readable document
tree — the same information the legacy `arxml2artext` tool's ARTEXT output carried — and lets you edit
parameter values in the details panel, without leaving VS Code.

> Status: implemented, 0.1.0. `src/core/` (detection, scanner, model, ordering, resolution,
> validation, offset index) and `src/editor/` (custom editor provider, row model, virtual renderer,
> filter, navigation, details editing, details inspector) are in place with 208 passing tests. Two
> things are deliberately not implemented and are listed under *Limitations*: CDATA-backed values
> are refused rather than edited, and reference resolution is single-file. The plan lives in
> `.trellis/tasks/10-14-ecuc-artext-editor/` (`prd.md`, `design.md`, `implement.md`) with the
> reference analysis in its `research/legacy-artext-analysis.md`, and the legacy transform is
> vendored as text under `reference/legacy-arxml2artext/`. The reading-experience overhaul
> (interaction model, collapse, hierarchy, filter feedback, node identity) is
> `.trellis/tasks/10-14-ecuc-editor-ux/`; the document-style default is archived under
> `.trellis/tasks/archive/2026-10/`, the quiet-source implementation is
> `.trellis/tasks/10-27-ecuc-editor-quiet-source/`, the virtualised renderer/search is
> `.trellis/tasks/10-28-ecuc-virtualized-render-search/`, and the Document-only UI/details-editing
> pass is `.trellis/tasks/10-28-ecuc-document-ui-polish/` with the design in
> `docs/ECUC_EDITOR_DESIGN_SPEC.md`.

## Why it exists

The reference extension (`ecucvalues-for-vscode`) shells out to a third-party `mmx.exe` transform to
turn the arxml into ARTEXT text, then parses that text back to find the arxml offsets for navigation.
That round-trip is slow, needs a Windows-only binary and a licence file, caches generated text beside
the user's file, and is only as precise as the text it produces — its own reference navigation is
broken for reference values for exactly that reason.

This editor parses the arxml **once**, in process, and keeps the source ranges of everything it
displays, so nothing has to be guessed back from a rendering.

## Opening it

The editor never claims the default for `.arxml`; a plain open still uses the text editor. That is
enforced by `priority: "option"` in the manifest — the default would claim every `.arxml`.

- **Command palette:** `ARXML Scope: Open with ECUC Editor`.
- **Explorer context menu** on an `.arxml` file, and the **editor context menu** when an `.arxml` is
  open in the text editor.
- **VS Code's own *Open With…*** lists the editor as well.

If the file is not an `.arxml`, or is an `.arxml` without ECUC values, the editor says so and hands
the file back to the text editor rather than showing an empty view.

## What it shows

The editor opens in **Document** view, a quiet-source monospace surface: the editor font (13px
fallback), 1.55 line height, a fold column, 4ch indentation, `{`/`}` on their own lines, one blank
row between modules, and inline metadata. There is no line-number gutter: the header, rows and braces
align on a stable left edge. Containers draw a vertical guide from their opening brace to their
closing brace; it is faded at rest and becomes clearer while the pointer is over the container.
Labels are neutral except the single key accent on parameter/reference names, the green container
name, and the yellow italic reference target; keywords, strings, numbers/hex, conditions, annotations
and booleans carry the semantic tokens. The `=` is muted punctuation. Parameter values are read-only
on the document. The **dark theme is the supported theme for now** (high contrast is kept as an
accessibility variant; there is no light-theme pass). A 26px strip holds the filter, count, larger
**Collapse**/**Expand** controls and **Details**; the details panel is a docked 260–340px panel, or a
bottom sheet at narrow widths. The details visibility persists.

Selection is stronger than a hover tint: a selected parameter gets the active selection fill plus a
2px focus rail and a thin outline, so the edited row is unambiguous. Selecting a container or module
also tints every visible parameter and sub-container in its subtree. The bracket guides themselves
remain structural and do not move with selection.

The host emits a compact row document (display order, parent/subtree, level/position, display fields
and search haystack), not a full-tree HTML string. The page flattens that row list through the
collapsed set and any active filter, then renders only the viewport plus a small overscan inside a
`role="tree"` window; top/bottom spacers preserve the full scroll height. Document rows are one line
high. The same row data drives selection, focus, the inspector, details editing and a re-scan, so a
selected row that is outside the window still shows its details.

| Entity | Shown as |
|---|---|
| Schema | the detected AUTOSAR release, e.g. `00048` |
| Package | the dotted package path |
| Module | `module` keyword + its full `DEFINITION-REF` path, its short-name, and its variant when present |
| Container | the `DEFINITION-REF` tail and its short-name, nested to any depth |
| Parameter | the `DEFINITION-REF` tail, the value, and the hexadecimal form of a numeric value as secondary information |
| Reference | the `DEFINITION-REF` tail, the target path, and the context of an instance reference |
| Conditions | `[SW-SYSCOND]` and post-build-variant conditions as `<Ref == value && …>` |
| Annotations | `[Label] text`, shown in comment form (`/* … */`) in Document view, without a label when absent |

The twisty column moves into the flat row, so labels align on exact 4ch steps and the braces align
with the row's text. A container with children shows its twisty at rest (0.7 opacity); hover or focus
raises it to full opacity, and a collapsed container keeps its chevron plus a `{ ... }` stub. There
are no list bullets, per-row borders, chips or fixed label columns. Long lines scroll horizontally
instead of wrapping; nothing is hidden — short-name, variant, hexadecimal form, context, conditions
and annotations move inline after the value. The empty filter state is a source comment
(`/* No entities match "…". */`) with a flat Clear filter action. The full text of any row remains
available in the details panel.

There are no line numbers. With the default `all` ordering the source order is non-monotonic; a
display-index gutter would be just as misleading, and **Reveal in source** is the deliberate way to
locate a row in the file. Each container's guide runs from its opening brace to its closing brace,
with one line per nesting level; it is faded at rest and clearer while the container is hovered.

Document colours are deliberately restrained. `schema`/`package`/`module` use the keyword token,
short names and textual values the string token, numbers and hex the numeric token, conditions the
meta token, and annotations the comment token (italic). Container names are green
(`--container-accent`, the fixed dark accent `#4EC9B0`; high contrast falls back to the editor
foreground); reference targets are yellow and italic (`--vscode-symbolIcon-functionForeground`).
Parameter and reference labels use the single key accent; module paths, context paths and
`=`/braces/punctuation stay neutral/muted. Reference targets use the link underline only on hover and
only when the target resolves in the same file. Selected parameters and selected containers/modules
use the strong active fill, a 2px focus rail and a thin outline; the selection stays unmistakable
while its visible descendants get a softer subtree tint. High contrast switches the tint to
outlines. Bracket guides are structural one-pixel lines, not a second selection colour.

The presentational reference is the post-processed ARTEXT output of the remote
`ref/ecucvalues-for-vscode` branch: `mmx` + `Arxml2Artext.mm`, then the extension's
`postProcessArtextGen` whitespace collapse inside `[...]`. The capture, the command and the scoped
colour mock live in the archived
`.trellis/tasks/archive/2026-10/10-27-ecuc-viewer-document-redesign/research/reference-artext/`.
The quiet-source design specification is `docs/ECUC_EDITOR_DESIGN_SPEC.md`. It is a look reference,
not a shipped format; nothing in the product reads or writes `.artext`.

Ordering matches the legacy tool: by `DEFINITION-REF` then identity, with the legacy exception list
preserved (see *Settings*).

## Browsing

The Document is for reading first; reaching the source and editing are deliberate. The interactions
below are the whole model; there is no second presentation.

| Interaction | Effect |
|---|---|
| Click a row — its label, its value or its empty space | selects that node; the document stays where it is |
| Click a parameter's value text | selects it, opens the details panel and focuses the value field |
| Click the `=` before a parameter value, or its label | selects the node only; it does not edit |
| Click a container's twisty | collapses or expands it; the selection does not move |
| Double-click a row, or `Ctrl`/`Alt`+`Enter` | reveals the node in the source (see *Navigation*) |
| Click a reference's target, or `Enter` on a followable reference | selects the same-file target container in the editor |
| Reference target with no same-file match | is not a link; it stays read-only and `Enter` reveals the reference |
| `Enter` on a parameter | opens/focuses its value in the details panel |
| `F2` on a focused parameter | opens/focuses its value in the details panel |
| `Enter` on a container | collapses or expands it |
| `Enter` on a leaf reference | follows/reveals as above |
| `Space` | selects the focused node, and nothing else |

A container or module with children has a toggle and reports its state through `aria-expanded`; a leaf
has no toggle. **Expand all** and **Collapse all** in the toolbar do not disturb the selection or the
scroll position. The collapsed set, the selection and the scroll position all survive a re-scan, so
editing the file in the text editor beside the document does not spring collapsed rows open while you type.

The filter box narrows the document by label, short-name or value and reports `shown of total`, or
`No matches` when nothing matches. It has a clear button and a count badge; a zero-match filter shows
an empty state with its own **Clear filter** action. Matched text is highlighted, and a collapsed
ancestor of a match is shown for as long as the filter is active — clearing the filter (or pressing
`Escape` in the box) restores exactly the collapsed set you had. The input is debounced; the filter
scans the precomputed row haystacks and only rendered rows get `<mark>` elements.

The tree is a flat, virtual `role="tree"`: treeitems carry `aria-level`, `aria-posinset`,
`aria-setsize`, `aria-expanded` and `aria-selected`, and the spacers are presentational. The
accessibility tree therefore exposes the rendered window, not every offscreen row; arrow keys and
type-ahead render the target before focusing it. This is a deliberate virtual-tree limitation, not
full-tree exposure to a screen reader.

The whole tree is keyboard-navigable: the arrow keys traverse and collapse, `Home`/`End` and
`PageUp`/`PageDown` move through the visible rows, and typing a letter jumps to the next label
starting with it.

## Details panel

Selecting a node fills the **details** panel on the right. It shows the node's kind, primary label,
full `DEFINITION-REF`, short name and variant, value (as an editable field for parameters),
hexadecimal form, target and context (references), conditions and annotations. There is no Source
block: **Reveal in source** is the deliberate way to locate the node in the file. The panel's only
action is **Reveal in source**; the old Copy path/Copy value/Copy target actions and the host
clipboard path are gone. The panel starts **hidden**, so the document gets the full width; the
**Details** toolbar button shows or hides it. The preference is remembered through the webview state,
so it survives a re-scan and a reload.

## Editing

Only the text content of a parameter's `<VALUE>` element is ever written.

- Click a parameter's value text, or press `F2`/`Enter` while it is focused, to open the value field
  in the details panel; `Enter` commits, `Escape` restores the current value, and `Tab`/`Shift`+`Tab`
  commits and moves to the adjacent parameter. The document itself is read-only: clicking `=`, the
  label or a non-value part of the row selects without editing. There is no `F2` hint on the line.
- A refused value — one that is invalid for its parameter kind, or that XML cannot represent — keeps
  **the text you typed**, marks the details field invalid, and says why. Nothing is discarded.
- A value with content has **just that content** replaced; a self-closing or empty `<VALUE/>` becomes
  `<VALUE>text</VALUE>`. Nothing else in the file changes — not indentation, not line endings, not
  attribute spacing, not sibling order.
- Values are escaped on write, so `&`, `<` and `>` survive a round-trip.
- Numerical parameters accept `true`/`false`, decimal integers, hexadecimal literals, and decimal
  fractions with an optional exponent. A value that is invalid for its parameter kind, or that XML
  cannot represent, is **refused with an explanation and the file is left untouched**.
- A value backed by a CDATA section is shown but **not editable**: it is refused rather than risk
  writing into the section, because CDATA-aware escaping (splitting on `]]>`) is not implemented.
- An edit that changes nothing does not mark the file dirty.
- Ctrl+Z and Ctrl+Y work through VS Code's own undo history, one press per edit; save and revert
  behave like any other editor.

Deliberately not supported, because each would mean rewriting structure that this editor only reads:
adding or removing containers, parameters or references; renaming a short-name; **retargeting a
reference** (references are read-only — only parameter values are editable); reformatting.

## Navigation

- **View → source:** revealing a node opens the file in the text editor with that node's range
  selected. Revealing is **non-destructive**: the ECUC editor's tab stays open, the source opens
  *beside* it as a preview, and focus stays in the editor. `arxmlScope.ecuc.editor.revealMode` changes
  this (see *Settings*).
- **Source → view:** with the cursor in the arxml text editor, the command opens the custom editor at
  the innermost node under the cursor.
- **References:** a reference target is a link only when it resolves in the same file. Following it
  selects the target container in the ECUC editor (scrolls/focuses it); an absent or ambiguous
  target is not a link and produces no navigation. *Reveal in source* remains a separate action.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `arxmlScope.ecuc.editor.sort` | `all` | `all` applies the legacy sort; `declaration` keeps the file's authored order |
| `arxmlScope.ecuc.editor.sortExcept` | 15 entries | `DEFINITION-REF` tails that keep declaration order even under `all` |
| `arxmlScope.ecuc.editor.revealMode` | `beside` | Where *Reveal in ARXML Source* shows the file: `beside` opens it next to the ECUC editor and keeps focus in the editor; `focus` opens it beside and moves focus there; `replace` swaps the ECUC editor's tab for the text editor, as older versions did |

The default exception list is the legacy tool's, carried over unchanged. The reveal mode is read at
every reveal, so changing it takes effect without a reload.

## Development preview harness

The webview can be rendered outside VS Code for visual work:

```bash
npm run preview:ecuc     # compile, then serve http://127.0.0.1:4173/
npm run preview:check    # render every fixture x theme and hit the server; no browser
```

The harness wraps the **production** `renderHtml` output with a stubbed `acquireVsCodeApi`, a theme
preset (dark, high contrast), fixture/theme/sort switches, a simulated row-data re-scan,
notice injection and a message log. It binds to `127.0.0.1`, reads the committed fixtures (and, for
manual viewing, the optional local `../sample` directory described below), adds no runtime dependency
and is never imported by the extension. `?chrome=0` hides the preview panel for clean screenshots.
`preview:check` asserts the production row JSON and the Document virtual shell (spacers, window,
inspector, empty state), not a full-tree HTML string. The harness no longer exposes a Tree view or a
view seed; Document is the only presentation.

It is a development tool, not a substitute for a VS Code webview: it cannot prove VS Code's own theme
variable resolution, the real custom-editor tab/focus behaviour or accessibility-tree exposure. Those
remain Extension Development Host checks.

When `../sample` exists (by default `D:\workspace\sample` here), `preview:ecuc` lists its files as
`sample/<name>`. `preview:check` never includes them, so CI stays deterministic.

## Synthetic samples and performance

```bash
npm run samples:ecuc                 # writes ../sample, does not commit anything
npm run perf:ecuc -- <file>          # scanner/index/render benchmark, no browser
```

The generator writes `minimal.arxml`, `display-rules.arxml`, `references.arxml`, `deep.arxml`,
`large.arxml` (~4,000 nodes) and `huge.arxml` (~12,000 nodes) plus a README. They are synthetic, live
outside the repository and are never committed. The benchmark reports file size, node count, scanner,
node-index, `buildRows` and `renderHtml` medians and a post-run heap-used/RSS estimate (not a peak).
It does not measure browser layout/paint or a real VS Code webview; treat the numbers as evidence, not
a performance promise.

Local runs on 2026-10-27 (pre-virtualisation baseline): `large` scanned and rendered in tens of
milliseconds; `huge` took roughly 0.09–0.12 s to scan and 0.15–0.20 s to render. In the browser
harness a full-DOM page finished loading after ~0.8 s (`large`, 4,001 rows) and ~3.8 s (`huge`,
12,001 rows), and the filter pass took ~56 ms / ~102 ms.

After the Document-only pass (2026-10-28, headless Edge via CDP, dark, this machine): `large`
`DOMContentLoaded`/load 124–139 ms with a 1.4–2.1 ms row-filter scan; `huge` 210–288 ms with a
4.3–6.8 ms scan; the window held 32–33 treeitems (36–50 nodes including braces), and the top spacer,
rendered rows and bottom spacer summed exactly to the virtual total at every sampled scroll position
with no inter-row gap. The `sample/large` page payload is ~1.89 MB of escaped row JSON and
`sample/huge` ~5.67 MB (down from ~6.5 MiB before source/digits were removed);
`performance.memory.usedJSHeapSize` was ~5.3–5.8 MB after `large` and ~13.4–14.7 MB after `huge`.
Node-side `perf:ecuc` medians: `large` `buildRows` 14.1 ms / `renderHtml` 18.1 ms; `huge` 39.6 ms /
54.6 ms with 5.40 MiB of row JSON. The filter input deliberately waits 120 ms (debounce) before
running the scan; the scan itself is the 1.4–6.8 ms above. These are harness observations, not
VS Code webview timings; timings vary with load and the real webview also pays its own layout and
paint.

## Limitations

- One file at a time: references are not resolved across files, and workspaces are not indexed.
- CDATA-backed values are not editable (see *Editing*).
- No structural editing (see *Editing*).
- No comparison against a baseline. The legacy text diff is gone with the ARTEXT text form; a
  semantic comparison needs the AR-path matching planned for the broader roadmap and should not be
  reintroduced as a text diff.
- The dark theme is the supported presentation for now; light-theme styling is not maintained. High
  contrast is kept as an accessibility variant.
- Large-file performance is measured only on the synthetic samples; a real customer file is not
  measured. The page renders a virtual window, so performance scales with the viewport, but the
  real VS Code webview still needs an Extension Development Host check.
- The accessibility tree exposes the rendered virtual window, not every offscreen row. Levels,
  positions, sizes, expansion and selection are on the treeitems, and keyboard navigation renders a
  target before focusing it; a screen reader cannot browse an offscreen row without scrolling it in.

## Relationship to the legacy `arxml2artext`

ARTEXT survives here as the name of the information model, not as a format: nothing writes `.artext`
files, and there is no grammar, no `Open as ARTEXT`, and no text to compare. What is carried over is
its semantics — what it showed for each entity, how it ordered them, its 15-entry exception list, and
the schema-release derivation. What is dropped is everything that existed only because an external
process produced a text file: the binary, the cache, the licence gate, and the re-parsing of the
rendered output.

## Layout

- `src/core/ecuc/` — detection, scanner, model, ordering, resolution, validation. **No `vscode`
  imports**, so the same code can later serve a workspace index or a language server.
- `src/core/text/offsets.ts` — the line/offset index.
- `src/editor/` — the custom editor provider, row model (`renderRows.ts`), virtual-scroll math
  (`virtualScroll.ts`), page/row rendering (`renderHtml.ts`), filter, navigation, and the
  details-panel value editor (`ecucDetailsEditor.ts`).
- `src/commands.ts` — the commands and the activation gate.
- `src/spikes/` — throwaway Step 0 scaffolding, awaiting a manual run and then deletion.
