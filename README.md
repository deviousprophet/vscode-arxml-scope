# ARXML Scope

[![Visual Studio Marketplace](https://img.shields.io/badge/Visual_Studio_Marketplace-blue)](https://marketplace.visualstudio.com/items?itemName=deviousprophet.vscode-arxml-scope)
[![Open VSX Registry](https://img.shields.io/badge/Open_VSX_Registry-c160ef)](https://open-vsx.org/extension/deviousprophet/vscode-arxml-scope)
[![GitHub Release](https://img.shields.io/github/v/release/deviousprophet/vscode-arxml-scope?label=Latest%20Release&color=brightgreen&logo=github)](https://github.com/deviousprophet/vscode-arxml-scope/releases)
[![License](https://img.shields.io/github/license/deviousprophet/vscode-arxml-scope?color=yellow)](https://github.com/deviousprophet/vscode-arxml-scope/blob/master/LICENSE)

Browse and edit AUTOSAR ECUC-Values files in VS Code without reading raw XML. The ECUC editor presents
modules, containers, parameters and references as a keyboard-navigable document, with a tabbed
sidebar for details and condition values, whole-tree search, and a read-only semantic diff.

## What it does

| Capability | What you get |
|---|---|
| Open | An opt-in ECUC editor for `.arxml` files. A plain open still uses the text editor. |
| Browse | A Document view with indentation, braces, editor-style fold controls, collapse/expand, virtual scrolling and a resizable **Details** / **Conditions** sidebar. |
| Search | Press `Enter` to search the whole tree. Every match is highlighted, the current match is stronger, and `Enter` / `Shift+Enter` move between matches. Search covers the visible label, value, short name, variant, context, condition and annotation text. |
| Inspect | One scrolling **Details** section shows the AUTOSAR type, Decimal/Hexadecimal/Binary values, target, context, conditions and annotations. |
| Edit | Parameter values and container `Short name` / `Definition` fields, with type-aware validation. Condition values are stored per workspace and edited with explicit Edit/Save/Cancel actions. |
| Compare | A read-only semantic diff for two ECUC-Values ARXML files, with aligned panes, a changes-only view, previous/next navigation, reveal-in-source and live refresh. |
| Navigate | Jump to a same-file reference target, reveal a node in the source, or open the source editor at the ECUC node under the cursor. The editor commands live under the `ARXML Scope` context submenu. |
| Stay safe | Only the edited element text is written; invalid values are refused. No derived file, cache or index is created. |

## Quick start

1. Install the extension and open a folder containing `.arxml` files.
2. Right-click an ECUC-Values file and choose **ARXML Scope → Open with ECUC Editor**, or use *Open With…*.
3. Select a row to inspect it. Edit a parameter value or a container field in **Details** and press
   `Enter`; `Escape` restores it.
4. Use **Search** by typing a query and pressing `Enter`. Use `Enter` / `Shift+Enter` for the next and
   previous match.
5. Open the **Conditions** tab to enter `SW-SYSCOND` constant values. Rows disabled by a false
   condition are dimmed.
6. To compare files, right-click the first file and choose **ARXML Scope → Select as First File to
   Compare**, then right-click the second and choose **Compare with First File**. Alternatively,
   select two ARXML files and choose **Compare Two ARXML Files…**.

A plain open still uses VS Code's text editor. The custom editor is opt-in.

## Good to know

- Reference resolution is **same-file** for now; no workspace index yet.
- Only parameter `<VALUE>` text and container `<SHORT-NAME>` / `<DEFINITION-REF>` text are written.
  References are not editable.
- A value backed by CDATA is shown but not editable.
- Condition values are stored per workspace, not written beside the ARXML.
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
