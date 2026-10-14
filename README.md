# ARXML Scope

Navigate, validate and explore AUTOSAR ARXML files in VS Code: reference navigation, ECUC viewer and semantic search.

ARXML files are large, deeply nested and full of cross-file references. ARXML Scope indexes your workspace so you can work with AUTOSAR concepts instead of raw XML.

> **Status:** in development. The features below describe the planned first releases.

## Features

- **ECUC viewer:** browse ECU configuration values as readable trees and tables, with parameter and container definitions resolved.
- **Outline tree:** see packages, components, interfaces and ECU configuration instead of raw XML tags.
- **Reference navigation:** Go to Definition and Find All References across files, plus detection of broken references.
- **Semantic validation:** broken references, type mismatches, duplicate names and ECUC checks, beyond plain XML validation.
- **Semantic search:** find elements by type, name, path or UUID, and see where they are used.
- **Schema-aware completion and hover:** driven by the bundled AUTOSAR schemas.
- **Classic and Adaptive Platform** support, with the schema version detected per file.

All tooling is read-only: ARXML Scope never modifies your files.

## Getting Started

1. Install the extension.
2. Open a folder containing `.arxml` files.
3. Wait for the status bar to show the indexed file count, then open the ARXML Scope view in the Activity Bar.

## Requirements

- VS Code 1.85 or later (adjust to your `engines.vscode` value).

## Roadmap

1. Navigation and ECUC viewer (read-only)
2. Full validation, completion and hover
3. Architecture graphs and ARXML-aware diff
4. Editing features (rename, formatter, quick fixes)

## Contributing

Issues and pull requests are welcome. Please include a minimal, non-confidential ARXML sample when reporting a bug.

## License

See [LICENSE](LICENSE).

---

*AUTOSAR is a registered trademark of the AUTOSAR partnership. This extension is an independent project and is not affiliated with or endorsed by AUTOSAR.*