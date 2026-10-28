# ECUC Editor

A VS Code custom editor for ECUC-Values `.arxml` files: it renders the file as a readable document
tree — the same information the legacy `arxml2artext` tool's ARTEXT output carried — and lets you edit
parameter values in place, without leaving VS Code.

> Status: implemented, 0.1.0. `src/core/` (detection, scanner, model, ordering, resolution,
> validation, offset index) and `src/editor/` (custom editor provider, row model, virtual renderer,
> filter, navigation, value editing, details inspector) are in place with 212 passing tests. Two
> things are deliberately not implemented and are listed under *Limitations*: CDATA-backed values
> are refused rather than edited, and reference resolution is single-file. The plan lives in
> `.trellis/tasks/10-14-ecuc-artext-editor/` (`prd.md`, `design.md`, `implement.md`) with the
> reference analysis in its `research/legacy-artext-analysis.md`, and the legacy transform is
> vendored as text under `reference/legacy-arxml2artext/`. The reading-experience overhaul
> (interaction model, collapse, hierarchy, filter feedback, node identity) is
> `.trellis/tasks/10-14-ecuc-editor-ux/`; the document-style default is archived under
> `.trellis/tasks/archive/2026-10/`, the quiet-source implementation is
> `.trellis/tasks/10-27-ecuc-editor-quiet-source/`, and the virtualised renderer/search is
> `.trellis/tasks/10-28-ecuc-virtualized-render-search/` with the design in
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
fallback), 1.55 line height, real ARXML source line numbers in a left gutter, a fold column, 4ch
indentation, `{`/`}` on their own lines, one blank row between modules, and inline metadata. The
schema/package header and the braces are unnumbered. Labels are neutral except the single key accent
on parameter/reference names; keywords, strings, numbers/hex, conditions, annotations and booleans
carry the semantic tokens. The `=` is muted punctuation. Reference targets are plain until hover;
values have no dotted underline (click or `F2` still edits them). A 26px strip holds the filter,
count, collapse/expand icons, the **Document | Tree** switch and **Details**; the details panel is a
docked 260–340px panel, or a bottom sheet at narrow widths. The view and details state persist.

The host emits a compact row document (display order, parent/subtree, level/position, display fields,
source position and search haystack), not a full-tree HTML string. The page flattens that row list
through the collapsed set and any active filter, then renders only the viewport plus a small
overscan inside a `role="tree"` window; top/bottom spacers preserve the full scroll height. Document
rows are one line high; Tree rows have fixed short/tall heights for the one-line metadata area. The
same row data drives selection, focus, the inspector, editing and a re-scan, so a selected row that
is outside the window still shows its details.

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

In Document view the tree's twisty column moves into the gutter, so labels align on exact 4ch
steps and the braces align with the parent row. Expanded fold chevrons appear while the pointer is
over the tree or focus is inside it; a collapsed container always shows its chevron and a `{ ... }`
stub. There are no list bullets, per-row borders, chips or fixed label columns. Long lines scroll
horizontally instead of wrapping; nothing is hidden — short-name, variant, hexadecimal form, context,
conditions and annotations move inline after the value. The empty filter state is a source comment
(`/* No entities match "…". */`) with a flat Clear filter action. Tree view keeps its two-line grid,
chips, glyphs and per-kind accents, with the shared strip, typography and token colours. The full
text of any row remains available in the details panel.

Line numbers are the **real ARXML source lines** (`data-line`), the same line *Reveal in source*
jumps to. With the default `all` ordering they can appear non-monotonic because rows are ordered by
`DEFINITION-REF`; `declaration` ordering gives ascending line numbers. This is deliberate: the gutter
is a source locator, not a display index.

Document colours are deliberately restrained. `schema`/`package`/`module` use the keyword token,
short names and textual values the string token, numbers and hex the numeric token, conditions the
meta token, and annotations the comment token (italic). Parameter and reference labels use the single
key accent; module paths, container labels, context paths and reference targets are neutral; `=`,
braces and punctuation use the muted punctuation token. Reference targets use the link colour plus
underline only on hover. In Tree view each kind also carries its own inline-SVG marker and accent, so
the kinds are distinguishable where colour alone is not enough. Selected rows use a translucent
editor tint and a brighter line number; focus adds a 2px gutter rail, and the syntax colours stay.
The light theme trades the tint for token contrast, so the line number (Document) and, when focused,
the rail carry the selection there. The `F2` hint appears on the selected parameter line. High contrast switches the tint to
outlines.

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

Both views are for reading first; reaching the source is deliberate. The interactions below work the
same in Document and Tree view.

| Interaction | Effect |
|---|---|
| Click a row — its label, its value or its empty space | selects that node; the view stays where it is |
| Click a container's twisty (revealed on hover in Document view) | collapses or expands it; the selection does not move |
| Double-click a row, or `Ctrl`/`Alt`+`Enter` | reveals the node in the source (see *Navigation*) |
| Click a reference's target, or `Enter` on a reference | follows the reference |
| `Enter` on a container | collapses or expands it |
| `Enter` on a leaf | reveals it |
| `Space` | selects the focused node, and nothing else |

A container or module with children has a toggle and reports its state through `aria-expanded`; a leaf
has no toggle. **Expand all** and **Collapse all** in the toolbar do not disturb the selection or the
scroll position. The collapsed set, the selection and the scroll position all survive a re-scan, so
editing the file in the text editor beside the tree does not spring the tree open while you type.

The filter box narrows the tree by label, short-name or value and reports `shown of total`, or
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
full `DEFINITION-REF`, short name and variant, value and hexadecimal form (parameters), target and
context (references), conditions, annotations, and the source range as `Lline:column - Lline:column`.
The range is computed from the document text, not from the displayed order.

The panel's actions are **Reveal in source**, **Copy path** and **Copy value** (or **Copy target** for
a reference). Copying goes through the host clipboard and does not touch the file. The panel starts
**hidden**, so Document view gets the full width; the **Details** toolbar button shows or hides it.
The preference and the selected view are remembered through the webview state, so they survive a
re-scan and a reload.

## Editing

Only the text content of a parameter's `<VALUE>` element is ever written.

- Click a parameter's value (or press `F2` while it is focused) to edit it, `Enter` to commit,
  `Escape` to cancel. A parameter's value shows a tooltip and a hover affordance saying it is editable;
  clicking the label selects the node, it does not reveal it. `Tab` and `Shift`+`Tab` commit and move
  to the next or previous parameter's value. Scrolling with the editor open moves the input to the
  rebuilt row while that row stays in the window; if it leaves the window the edit closes without
  writing, so a later `Enter` cannot commit an invisible stale value.
- A refused value — one that is invalid for its parameter kind, or that XML cannot represent — keeps
  **the text you typed**, marks the field invalid, and says why. Nothing is discarded.
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
  *beside* it as a preview, and focus stays in the tree. `arxmlScope.ecuc.editor.revealMode` changes
  this (see *Settings*).
- **Source → view:** with the cursor in the arxml text editor, the command opens the custom editor at
  the innermost node under the cursor.
- **References:** following a reference selects its target when that target is in the same file. A
  target that is absent, or ambiguous, produces a message and no navigation.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `arxmlScope.ecuc.editor.sort` | `all` | `all` applies the legacy sort; `declaration` keeps the file's authored order |
| `arxmlScope.ecuc.editor.sortExcept` | 15 entries | `DEFINITION-REF` tails that keep declaration order even under `all` |
| `arxmlScope.ecuc.editor.revealMode` | `beside` | Where *Reveal in ARXML Source* shows the file: `beside` opens it next to the ECUC editor and keeps focus in the tree; `focus` opens it beside and moves focus there; `replace` swaps the ECUC editor's tab for the text editor, as older versions did |

The default exception list is the legacy tool's, carried over unchanged. The reveal mode is read at
every reveal, so changing it takes effect without a reload.

## Development preview harness

The webview can be rendered outside VS Code for visual work:

```bash
npm run preview:ecuc     # compile, then serve http://127.0.0.1:4173/
npm run preview:check    # render every fixture x theme and hit the server; no browser
```

The harness wraps the **production** `renderHtml` output with a stubbed `acquireVsCodeApi`, a theme
preset (light, dark, high contrast), fixture/theme/sort switches, a simulated row-data re-scan,
notice injection and a message log. It binds to `127.0.0.1`, reads the committed fixtures (and, for
manual viewing, the optional local `../sample` directory described below), adds no runtime dependency
and is never imported by the extension. `?chrome=0` hides the preview panel for clean screenshots;
`?view=document` or `?view=tree` seeds the saved view state so either presentation can be captured
without clicking or relying on `localStorage`. `preview:check` asserts the production row JSON and the
virtual shell (spacers, window, inspector, empty state), not a full-tree HTML string.

It is a development tool, not a substitute for a VS Code webview: it cannot prove VS Code's own theme
variable resolution, the real custom-editor tab/focus behaviour or host clipboard permissions. Those
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

After the virtualised renderer (2026-10-28, headless Edge via CDP, Document/Tree, dark, this machine):
`large` `DOMContentLoaded`/load 127–155 ms with a 1.8–2.2 ms row-filter scan; `huge` 253–259 ms with
a 5.6–8.6 ms scan; the window held 27–33 treeitems (27–44 nodes including Document braces), and the
top spacer, rendered rows and bottom spacer summed exactly to the virtual total at every sampled scroll
position with no inter-row gap. The `sample/huge` page payload is ~6.5 MiB of escaped row JSON and
`performance.memory.usedJSHeapSize` was ~14–15 MB after load. The filter input deliberately waits
120 ms (debounce) before running the scan; the scan itself is the 1.8–8.6 ms above. Node-side
`buildRows`/`renderHtml` medians were 15/20 ms for `large` and 41/57 ms for `huge`. These are harness
observations, not VS Code webview timings; timings vary with load and the real webview also pays its
own layout and paint.

## Limitations

- One file at a time: references are not resolved across files, and workspaces are not indexed.
- CDATA-backed values are not editable (see *Editing*).
- No structural editing (see *Editing*).
- No comparison against a baseline. The legacy text diff is gone with the ARTEXT text form; a
  semantic comparison needs the AR-path matching planned for the broader roadmap and should not be
  reintroduced as a text diff.
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
  (`virtualScroll.ts`), page/row rendering (`renderHtml.ts`), filter, navigation, and the value-edit
  path.
- `src/commands.ts` — the commands and the activation gate.
- `src/spikes/` — throwaway Step 0 scaffolding, awaiting a manual run and then deletion.
