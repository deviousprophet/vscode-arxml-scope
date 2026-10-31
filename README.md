# ARXML Scope

[![Visual Studio Marketplace](https://img.shields.io/badge/Visual_Studio_Marketplace-blue)](https://marketplace.visualstudio.com/items?itemName=deviousprophet.vscode-arxml-scope)
[![Open VSX Registry](https://img.shields.io/badge/Open_VSX_Registry-c160ef)](https://open-vsx.org/extension/deviousprophet/vscode-arxml-scope)
[![GitHub Release](https://img.shields.io/github/v/release/deviousprophet/vscode-arxml-scope?label=Latest%20Release&color=brightgreen&logo=github)](https://github.com/deviousprophet/vscode-arxml-scope/releases)
[![License](https://img.shields.io/github/license/deviousprophet/vscode-arxml-scope?color=yellow)](https://github.com/deviousprophet/vscode-arxml-scope/blob/master/LICENSE)

Browse and edit AUTOSAR ECUC-Values files without reading raw XML. The ECUC editor presents modules,
containers, parameters and references as a keyboard-navigable document, with a tabbed sidebar for
details and condition values, whole-tree search, and a read-only semantic diff. The custom editor is
opt-in: a plain open still uses the text editor.

## Quick start

1. Install the extension and open a folder containing `.arxml` files.
2. Right-click an ECUC-Values file and choose **ARXML Scope → Open with ECUC Editor**, or use *Open With…*.
3. Select a row to inspect it; edit a parameter value or a container field in **Details** and press
   `Enter`.
4. Type a query in **Search** and press `Enter`; use the **Conditions** tab for `SW-SYSCOND` values.
5. To compare, choose **ARXML Scope → Select as First File to Compare** on one file, then
   **ARXML Scope → Compare with First File** on the other.

## Documentation

- [Documentation index](docs/README.md) — the ECUC editor and semantic diff guides.
- [ECUC editor guide](docs/ECUC_EDITOR.md) — opening, editing, Conditions and settings.
- [Semantic diff guide](docs/DIFF.md) — selecting files, change classes, navigation and limitations.
- [Synthetic ECUC example](examples/README.md) — a small file to open, edit and compare.
- [Changelog](CHANGELOG.md) · [License](LICENSE)

## Good to know

- Reference resolution is same-file for now; there is no workspace index yet.
- Edits are limited to parameter `<VALUE>` text and container `<SHORT-NAME>` / `<DEFINITION-REF>` text;
  references are not editable.
- A value backed by CDATA is shown but cannot be edited.
- Condition values are stored per workspace, not written beside the ARXML.
- Only ECUC-Values `.arxml` files are supported; other files stay in the text editor.

## Issues

Found a bug or want a feature? Open an issue: [Issues](https://github.com/deviousprophet/vscode-arxml-scope/issues). Include a short description, steps to reproduce, and sample files when possible.

---

*AUTOSAR is a registered trademark of the AUTOSAR partnership. This extension is an independent project
and is not affiliated with or endorsed by AUTOSAR.*
