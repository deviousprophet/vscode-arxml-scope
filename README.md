# ARXML Scope

[![Visual Studio Marketplace](https://img.shields.io/badge/Visual_Studio_Marketplace-blue)](https://marketplace.visualstudio.com/items?itemName=deviousprophet.vscode-arxml-scope)
[![Open VSX Registry](https://img.shields.io/badge/Open_VSX_Registry-c160ef)](https://open-vsx.org/extension/deviousprophet/vscode-arxml-scope)
[![GitHub Release](https://img.shields.io/github/v/release/deviousprophet/vscode-arxml-scope?label=Latest%20Release&color=brightgreen&logo=github)](https://github.com/deviousprophet/vscode-arxml-scope/releases)
[![License](https://img.shields.io/github/license/deviousprophet/vscode-arxml-scope?color=yellow)](https://github.com/deviousprophet/vscode-arxml-scope/blob/master/LICENSE)

Browse and edit AUTOSAR ECUC-Values files in VS Code without reading raw XML. The ECUC editor presents
modules, containers, parameters and references as a keyboard-navigable document, with types, value
formats and source locations in one place.

## What it does

| Capability | What you get |
|---|---|
| Open | An opt-in ECUC editor for `.arxml` files. A plain open still uses the text editor. |
| Browse | A Document view with indentation, braces, editor-style fold controls, collapse/expand, filtering and virtual scrolling. |
| Inspect | Parameter details show the AUTOSAR type, Decimal/Hexadecimal/Binary values, target, context, conditions and annotations. |
| Edit | Parameter values in the details panel. Editing is type-aware: integer/hex/binary, float, Boolean selector or text. |
| Navigate | Jump to a same-file reference target, reveal a node in the source, or open the source editor at the ECUC node under the cursor. |
| Stay safe | Only `<VALUE>` text is written; invalid values are refused. No derived file, cache or index is created. |

## Quick start

1. Install the extension and open a folder containing `.arxml` files.
2. Right-click an ECUC-Values file and choose **Open with ECUC Editor**, or use *Open With…*.
3. Select a row to inspect it. Edit a parameter in the details panel and press `Enter`; `Escape` restores it.

A plain open still uses VS Code's text editor. The custom editor is opt-in.

## Good to know

- Reference resolution is **same-file** for now; no workspace index yet.
- References are not editable. Only parameter `<VALUE>` text is written.
- A value backed by CDATA is shown but not editable.
- The ECUC editor currently supports ECUC-Values files; files without ECUC values are handed back to
  the text editor.

## Documentation

- [Changelog](CHANGELOG.md)
- [License](LICENSE)

## Issues

Found a bug or want a feature? Open an issue: [Issues](https://github.com/deviousprophet/vscode-arxml-scope/issues). Include a short description, steps to reproduce, and sample files when possible.

---

*AUTOSAR is a registered trademark of the AUTOSAR partnership. This extension is an independent project
and is not affiliated with or endorsed by AUTOSAR.*
