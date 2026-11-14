# ARXML Scope Documentation

User-facing guides for the ECUC editor and the semantic diff. The Trellis coding specs under
`.trellis/spec/frontend/` describe how the same features are implemented; these pages describe what
the extension does and how to use it.

| Guide | What it covers |
|---|---|
| [ECUC editor](ECUC_EDITOR.md) | Opening a file, the Document tree, Details, editing rules, Conditions, reveal/navigation, settings and limitations. |
| [Semantic diff](DIFF.md) | Selecting and comparing two files, change classes, search/view/swap/collapse, refresh and limitations. |
| [Design system](../DESIGN.md) | The webview visual identity: theme tokens, typography, spacing, shapes and component rules. |
| [Two-way merge](MERGE.md) | Turning the diff into a merge: per-row copy arrows, what a copy replaces, and the safety rules. |
| [Test plan](TEST_PLAN.md) | The regression plan for every feature: layers, gates, edge cases and the known gaps. |
| [Synthetic example](../examples/README.md) | A small ECUC-Values file to open, edit and compare without customer data. |

Also useful:

- [Root README](../README.md) — installation and quick start.
- [Changelog](../CHANGELOG.md) — released changes.
- [Frontend guidelines](https://github.com/deviousprophet/vscode-arxml-scope/blob/main/.trellis/spec/frontend/index.md) — the implementation contracts behind these guides.

All sample content in this repository is synthetic. Do not commit a real customer ARXML file.
