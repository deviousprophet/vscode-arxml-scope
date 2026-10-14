# Change Log

All notable changes to the "vscode-arxml-scope" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.1.0]

First release with the ECUC editor. The rest of the extension's feature list is still planned.

### Added

- **ECUC editor** — a custom editor for ECUC-Values `.arxml` files that renders the file as a
  keyboard-navigable document tree: the same information the legacy `arxml2artext` tool's ARTEXT output
  carried, read straight from the arxml instead of through a generated text file.
  Opt-in through `ARXML Scope: Open with ECUC Editor`, the Explorer and editor context menus, or
  VS Code's own *Open With…*. A plain open still uses the text editor.
- **Value editing** — the text content of a parameter's `<VALUE>` is edited in place. Validation runs
  before every write, so a value that is invalid for its parameter kind, or that XML cannot represent,
  is refused with an explanation and the file is left byte-identical. Nothing else in the file moves:
  not indentation, not line endings, not attribute spacing, not sibling order.
- Undo, redo, save and revert use VS Code's own text-document history, so they behave like any other
  editor.
- Filter box, arrow-key navigation, hover showing the full `DEFINITION-REF` path, and bidirectional
  navigation between the view and the source text editor. Following a reference selects its target when
  the target is in the same file.
- Ordering that matches the legacy tool — by `DEFINITION-REF`, then by identity — including its
  15-entry sort exception list, exposed as `arxmlScope.ecuc.editor.sort` and
  `arxmlScope.ecuc.editor.sortExcept`.
- A dependency-free core under `src/core/`: detection, a single-pass streaming scanner, the information
  model, ordering, resolution, validation and a line/offset index. It imports no `vscode`, so the same
  code can later serve a workspace index or a language server.

### Notes

- Nothing is written anywhere except the `<VALUE>` text that was edited. No derived file, cache or
  index is ever produced beside a user's file.
- **References are not editable.** Only parameter values are; retargeting a reference would mean
  rewriting structure this editor only reads, and is deliberately out of scope.
- A `<VALUE>` backed by a CDATA section is shown but not editable: it is refused rather than risking a
  corrupt section. CDATA-aware escaping is not implemented.
- Reference resolution is single-file; no workspace index yet.
- The legacy `arxml2artext` transform is vendored as text under `reference/legacy-arxml2artext/` for
  reference only. Its `bin/`, `plugins/` and licence file are deliberately not included.
