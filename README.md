# ARXML Scope

[![Visual Studio Marketplace](https://img.shields.io/badge/Visual_Studio_Marketplace-blue)](https://marketplace.visualstudio.com/items?itemName=deviousprophet.vscode-arxml-scope)
[![Open VSX Registry](https://img.shields.io/badge/Open_VSX_Registry-c160ef)](https://open-vsx.org/extension/deviousprophet/vscode-arxml-scope)
[![GitHub Release](https://img.shields.io/github/v/release/deviousprophet/vscode-arxml-scope?label=Latest%20Release&color=brightgreen&logo=github)](https://github.com/deviousprophet/vscode-arxml-scope/releases)
[![License](https://img.shields.io/github/license/deviousprophet/vscode-arxml-scope?color=yellow)](https://github.com/deviousprophet/vscode-arxml-scope/blob/master/LICENSE)

Browse and edit AUTOSAR ECUC-Values files in VS Code without reading raw XML. The ECUC editor presents
modules, containers, parameters and references as a keyboard-navigable document, with a tabbed
sidebar for details and condition values, whole-tree search, and a read-only semantic diff.

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
- Only parameter `<VALUE>` text, container `<SHORT-NAME>` / `<DEFINITION-REF>` text, and whole
  container/parameter elements (delete/duplicate) are written. References are not editable.
- A value backed by CDATA is shown but not editable.
- Right-click a container or parameter to **Duplicate** or **Delete**. Duplicate inserts the copy
  after the original (a container copy asks for a unique short name); Delete removes the element.
  Both ask for confirmation and one `Ctrl+Z` restores the previous bytes.
- In the diff, type a query and press `Enter` to search; `Enter` / `Shift+Enter` move between
  matches. Use **Show all** / **Show diff only** to change the row set and **Swap sides** to mirror
  the panes. Row twisties still collapse subtrees.
- Condition values are stored per workspace, not written beside the ARXML.
- Hover a condition chip to see each referenced system constant and its entered value, one per line.
  `(not set)` means the constant has no value yet; the row's dimmed state still shows the result.
- Annotations appear as comment lines above their node; long conditions stay compact in the tree and
  wrap fully in **Details**.
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
