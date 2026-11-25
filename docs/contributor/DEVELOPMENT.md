# Development

How to build, test and run ARXML Scope locally, and where the deeper guides live. The
root [README](../../README.md) has the user-facing quick start; this page is for people
changing the extension.

## Setup and build

Use Node 26 and npm 11+, plus a Rust toolchain for the engine.

```bash
npm ci          # installs dependencies and applies the Monaco patch
npm run compile # builds the Rust engine, type-checks, lints and bundles the extension
npm test        # compiles first, then drives a real VS Code instance
```

`npm run compile` and `npm test` build the Rust engine binary first (`npm run engine:build`).
`npm run benchmark` runs the optional performance suite. The engine and its protocol are
described in [ENGINE.md](ENGINE.md) and [`rust/README.md`](../../rust/README.md).

## Where to go next

| Topic | Page |
|---|---|
| Regression layers, gates, case IDs and known gaps | [TEST_PLAN.md](TEST_PLAN.md) |
| Preview commands, seeded states, outputs and limits | [WEBVIEW_PREVIEW.md](WEBVIEW_PREVIEW.md) and the [`webview-preview` skill](../../.agents/skills/webview-preview/SKILL.md) |
| Engine lifecycle, status and limits | [ENGINE.md](ENGINE.md) |
| Retired pre-Monaco DOM interaction reference (historical only) | [legacy-dom-renderer.md](legacy-dom-renderer.md) |
| Agent test rules and the preview full-set gate | [`testing.md`](../../.trellis/spec/frontend/testing.md) |
| Preview audit invariants | [`preview-audit.md`](../../.trellis/spec/frontend/preview-audit.md) |

## Diff and editor implementation contracts

The user guides describe behaviour; these spec pages describe the code-level contracts
behind it:

| Area | Contract |
|---|---|
| Monaco surface: synthetic ECUC documents, find bridge, diff editor, gutter ownership, folding deviation | [`monaco.md`](../../.trellis/spec/frontend/monaco.md) |
| Pinned Monaco release, upstream hashes, the checked-in patch and the ARXML adapters | [`diff-parity.md`](../../.trellis/spec/frontend/diff-parity.md) |
| Semantic matching: candidate blocking, scores, work budget, fallback and benchmark guards | [`diff-matching.md`](../../.trellis/spec/frontend/diff-matching.md) |
| Diff component shell and title strip | [`component-diff-view.md`](../../.trellis/spec/frontend/components/component-diff-view.md) |
| Editor/diff sessions, protocol and error matrix | [`editor-lifecycle.md`](../../.trellis/spec/frontend/editor-lifecycle.md) |

## Documentation layout

`docs/user/` holds product guides, `docs/contributor/` holds setup, tests and engine
notes, and `.trellis/spec/` holds the agent implementation contracts. The audience rules
and the canonical-home table are in
[`documentation-architecture-guide.md`](../../.trellis/spec/guides/documentation-architecture-guide.md);
see also the [documentation index](../README.md).
