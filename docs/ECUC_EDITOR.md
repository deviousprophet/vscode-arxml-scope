# ECUC Editor

A VS Code custom editor for ECUC-Values `.arxml` files: it renders the file as a readable document
tree — the same information the legacy `arxml2artext` tool's ARTEXT output carried — and lets you edit
parameter values in place, without leaving VS Code.

> Status: implemented, 0.1.0. `src/core/` (detection, scanner, model, ordering, resolution,
> validation, offset index) and `src/editor/` (custom editor provider, rendering, filter, navigation,
> value editing) are in place with 97 passing tests. Two things are deliberately not implemented and
> are listed under *Limitations*: CDATA-backed values are refused rather than edited, and reference
> resolution is single-file. The plan lives in `.trellis/tasks/10-14-ecuc-artext-editor/` (`prd.md`,
> `design.md`, `implement.md`) with the reference analysis in its
> `research/legacy-artext-analysis.md`, and the legacy transform is vendored as text under
> `reference/legacy-arxml2artext/`.

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

Hovering a container or parameter shows its full `DEFINITION-REF` path.

Ordering matches the legacy tool: by `DEFINITION-REF` then identity, with the legacy exception list
preserved (see *Settings*). A filter box narrows the tree by label, short-name or value. The whole tree
is keyboard-navigable with the arrow keys.

## Editing

Only the text content of a parameter's `<VALUE>` element is ever written.

- Click a parameter's value (or press `F2` while it is focused) to edit it, `Enter` to commit,
  `Escape` to cancel. Clicking the label still reveals the node in the source, as before.
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
  selected.
- **Source → view:** with the cursor in the arxml text editor, the command opens the custom editor at
  the innermost node under the cursor.
- **References:** following a reference selects its target when that target is in the same file. A
  target that is absent, or ambiguous, produces a message and no navigation.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `arxmlScope.ecuc.editor.sort` | `all` | `all` applies the legacy sort; `declaration` keeps the file's authored order |
| `arxmlScope.ecuc.editor.sortExcept` | 15 entries | `DEFINITION-REF` tails that keep declaration order even under `all` |

The default exception list is the legacy tool's, carried over unchanged.

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
