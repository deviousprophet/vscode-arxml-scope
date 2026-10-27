# ECUC Editor

A VS Code custom editor for ECUC-Values `.arxml` files: it renders the file as a readable document
tree — the same information the legacy `arxml2artext` tool's ARTEXT output carried — and lets you edit
parameter values in place, without leaving VS Code.

> Status: implemented, 0.1.0. `src/core/` (detection, scanner, model, ordering, resolution,
> validation, offset index) and `src/editor/` (custom editor provider, rendering, filter, navigation,
> value editing, details inspector) are in place with 147 passing tests. Two things are deliberately
> not implemented and are listed under *Limitations*: CDATA-backed values are refused rather than edited, and reference
> resolution is single-file. The plan lives in `.trellis/tasks/10-14-ecuc-artext-editor/` (`prd.md`,
> `design.md`, `implement.md`) with the reference analysis in its
> `research/legacy-artext-analysis.md`, and the legacy transform is vendored as text under
> `reference/legacy-arxml2artext/`. The reading-experience overhaul (interaction model, collapse,
> hierarchy, filter feedback, node identity) is `.trellis/tasks/10-14-ecuc-editor-ux/`.

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

| Entity | Shown as |
|---|---|
| Schema | the detected AUTOSAR release, e.g. `00048` |
| Package | the dotted package path |
| Module | its full `DEFINITION-REF` path, its short-name, and its variant when present |
| Container | the `DEFINITION-REF` tail and its short-name, nested to any depth |
| Parameter | the `DEFINITION-REF` tail, the value, and the hexadecimal form of a numeric value as secondary information |
| Reference | the `DEFINITION-REF` tail, the target path, and the context of an instance reference |
| Conditions | `[SW-SYSCOND]` and post-build-variant conditions as `<Ref == value && …>` |
| Annotations | `[Label] text`, including annotations without a label (the `/* … */` wrapper belongs to the dropped ARTEXT text form and is not shown) |

Rows keep the primary label and value on the first line and move short-name, variant, hexadecimal
form, context, conditions and annotations to a quieter second line. Long labels and values truncate
with a tooltip; the full text is in the details panel. Each kind — module, container, parameter,
reference — carries its own inline-SVG marker and accent, so the kinds are distinguishable in a
high-contrast theme where colour alone is not enough.

Ordering matches the legacy tool: by `DEFINITION-REF` then identity, with the legacy exception list
preserved (see *Settings*).

## Browsing

The tree is for reading first; reaching the source is deliberate.

| Interaction | Effect |
|---|---|
| Click a row — its label, its metadata or its empty space | selects that node; the view stays where it is |
| Click a container's twisty | collapses or expands it; the selection does not move |
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
`Escape` in the box) restores exactly the collapsed set you had.

The whole tree is keyboard-navigable: the arrow keys traverse and collapse, `Home`/`End` and
`PageUp`/`PageDown` move through the visible rows, and typing a letter jumps to the next label
starting with it.

## Details panel

Selecting a node fills the **details** panel on the right. It shows the node's kind, primary label,
full `DEFINITION-REF`, short name and variant, value and hexadecimal form (parameters), target and
context (references), conditions, annotations, and the source range as `Lline:column - Lline:column`.
The range is computed from the document text, not from the displayed order.

The panel's actions are **Reveal in source**, **Copy path** and **Copy value** (or **Copy target** for
a reference). Copying goes through the host clipboard and does not touch the file. The **Details**
toolbar button shows or hides the panel; hiding it gives the tree the full width. The preference is
remembered through the webview state, so it survives a re-scan and a reload.

## Editing

Only the text content of a parameter's `<VALUE>` element is ever written.

- Click a parameter's value (or press `F2` while it is focused) to edit it, `Enter` to commit,
  `Escape` to cancel. A parameter's value shows a tooltip and a hover affordance saying it is editable;
  clicking the label selects the node, it does not reveal it. `Tab` and `Shift`+`Tab` commit and move
  to the next or previous parameter's value.
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
preset (light, dark, high contrast), fixture/theme/sort switches, a simulated re-scan, notice
injection and a message log. It binds to `127.0.0.1`, reads only committed fixtures, adds no runtime
dependency and is never imported by the extension. `?chrome=0` hides the preview panel for clean
screenshots.

It is a development tool, not a substitute for a VS Code webview: it cannot prove VS Code's own theme
variable resolution, the real custom-editor tab/focus behaviour or host clipboard permissions. Those
remain Extension Development Host checks.

## Limitations

- One file at a time: references are not resolved across files, and workspaces are not indexed.
- CDATA-backed values are not editable (see *Editing*).
- No structural editing (see *Editing*).
- No comparison against a baseline. The legacy text diff is gone with the ARTEXT text form; a
  semantic comparison needs the AR-path matching planned for the broader roadmap and should not be
  reintroduced as a text diff.
- Large-file performance is unmeasured. The scanner is a single pass and the view renders the whole
  tree; if a real file proves slow, measure before optimising.

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
- `src/editor/` — the custom editor provider, rendering, filter, navigation, and the value-edit path.
- `src/commands.ts` — the commands and the activation gate.
- `src/spikes/` — throwaway Step 0 scaffolding, awaiting a manual run and then deletion.
