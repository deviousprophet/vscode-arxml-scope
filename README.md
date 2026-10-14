# ARXML Scope

Navigate, validate and explore AUTOSAR ARXML files in VS Code: an ECUC editor, reference navigation and semantic search.

ARXML files are large, deeply nested and full of cross-file references. ARXML Scope works with AUTOSAR concepts instead of raw XML.

> **Status:** in development. The ECUC editor is usable today (0.1.0); the rest of the feature list below is planned.

## Features

- **ECUC editor:** browse ECU configuration values as a readable, keyboard-navigable tree, and edit parameter values in place. Available now, and opt-in — a plain open still uses the text editor. See [docs/ECUC_EDITOR.md](docs/ECUC_EDITOR.md).
- **Outline tree:** see packages, components, interfaces and ECU configuration instead of raw XML tags.
- **Reference navigation:** Go to Definition and Find All References across files, plus detection of broken references.
- **Semantic validation:** broken references, type mismatches, duplicate names and ECUC checks, beyond plain XML validation.
- **Semantic search:** find elements by type, name, path or UUID, and see where they are used.
- **Schema-aware completion and hover:** driven by the bundled AUTOSAR schemas.
- **Classic and Adaptive Platform** support, with the schema version detected per file.

Everything is read-only except the ECUC editor, which writes only the `<VALUE>` text you edit and never creates a derived file.

## Getting Started

1. Install the extension.
2. Open a folder containing `.arxml` files.
3. Open an ECUC-Values `.arxml` with **ARXML Scope: Open ECUC Configuration** from the command palette, from the Explorer context menu, or through *Open With…*. A plain open uses the text editor.

## Requirements

- VS Code 1.125 or later.

## Roadmap

1. Navigation and ECUC editor (read-only browsing, plus in-place value editing) — available
2. Full validation, completion and hover
3. Architecture graphs and ARXML-aware diff
4. Editing features (rename, formatter, quick fixes)

## Contributing

Issues and pull requests are welcome. Please include a minimal, non-confidential ARXML sample when reporting a bug.

Work in progress is tracked under `.trellis/` — start with `.trellis/workflow.md`. The ECUC editor's
design and current status are in [docs/ECUC_EDITOR.md](docs/ECUC_EDITOR.md), and the legacy ARTEXT
mapping it replaces is vendored as text under
[reference/legacy-arxml2artext/](reference/legacy-arxml2artext/README.md).

## License

See [LICENSE](LICENSE).

---

*AUTOSAR is a registered trademark of the AUTOSAR partnership. This extension is an independent project and is not affiliated with or endorsed by AUTOSAR.*
