# ARXML Scope Documentation

`docs/` is the human documentation library: product guides for users and setup notes for
contributors. Code-level implementation contracts live in `.trellis/spec/`, and the
executable preview workflow lives in the `ux-review` skill's Preview mode. See the
[documentation architecture guide](../.trellis/spec/guides/documentation-architecture-guide.md)
for the audience rules.

## Start here

| Page | Audience | Purpose |
|---|---|---|
| [Documentation index](README.md) | Everyone | This page: the audience map for every file under `docs/`. |

## For users

| Page | Audience | Purpose |
|---|---|---|
| [ECUC editor](user/ECUC_EDITOR.md) | Users | Opening a file, the Document, Details, editing rules, Conditions, reveal/navigation, settings and limitations. |
| [Semantic diff](user/DIFF.md) | Users | Selecting and comparing two files, change classes, renamed containers, search/view/swap/collapse, refresh and limitations. |
| [Two-way merge](user/MERGE.md) | Users | Turning the diff into a merge: the built-in hover gutter copy actions, what a copy replaces, and the safety rules. |
| [Synthetic example](../examples/README.md) | Users | A small ECUC-Values file to open, edit and compare without customer data. |

## For contributors

| Page | Audience | Purpose |
|---|---|---|
| [Development](contributor/DEVELOPMENT.md) | Contributors | Setup, build, test and the links to the engine, preview, test plan and diff contracts. |
| [Engine](contributor/ENGINE.md) | Contributors/operators | The Rust engine's process model, lifecycle, restart/backoff, status command, support matrix and limits. |
| [Test plan](contributor/TEST_PLAN.md) | Contributors | The human regression plan: layers, commands, per-area gates, case IDs and known gaps. |
| [Design system](../DESIGN.md) | Contributors | The webview visual identity and design contract: theme tokens, typography, spacing and component rules; the `design:lint` target. |
| [Changelog](../CHANGELOG.md) | Everyone | Released changes. |
| [Root README](../README.md) | Everyone | Installation, quick start and the repository overview. |

## Agent contracts

Agent-facing work does not live in `docs/`. Code-level contracts are indexed in
[`.trellis/spec/frontend/index.md`](../.trellis/spec/frontend/index.md), thinking guides in
[`.trellis/spec/guides/index.md`](../.trellis/spec/guides/index.md), the executable preview
workflow in the [`ux-review` Preview mode](../.agents/skills/ux-review/SKILL.md), and
the engine wire protocol in [`rust/README.md`](../rust/README.md).

All sample content in this repository is synthetic. Do not commit a real customer ARXML file.
