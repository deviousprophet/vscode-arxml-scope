# Design: spec and docs parity

## Spec tree

```text
.trellis/spec/frontend/
├── index.md
├── directory-structure.md
├── component-guidelines.md
├── css-guidelines.md          (new)
├── type-safety.md             (replace placeholders)
├── testing.md
├── quality-guidelines.md
├── state-management.md
├── editor-lifecycle.md        (new)
├── hook-guidelines.md
├── components/
│   ├── index.md
│   ├── component-template.md
│   ├── component-document-tree.md
│   ├── component-diff-view.md
│   ├── component-toolbar.md
│   ├── component-search-bar.md
│   ├── component-sidebar.md
│   ├── component-sidebar-conditions-panel.md
│   ├── component-sidebar-details-panel.md
│   ├── component-context-menu.md
│   └── component-details-editor.md
└── guides/
    ├── index.md
    ├── code-reuse-thinking-guide.md
    └── cross-layer-thinking-guide.md
```

## Content contracts

- **css-guidelines.md** — file placement per component, `styles/tokens.css` and `styles/base.css`,
  selector/DOM conventions, no inline `style` under the CSP, theme/contrast rules, row/virtualization
  CSS, esbuild CSS emission (`dist/<entry>.css`) and the test-side `cssImportHook`. Adapt Hex's
  section shape (placement, tokens, selectors, layout, exceptions) to real ECUC selectors.
- **editor-lifecycle.md** — 7-section code-spec for two scenarios: the ECUC editor
  (open → scan → `buildRows` → webview boot → model/edit/select messages → write → re-scan → reveal
  → dispose) and the diff panel (select first file → compare → `buildDiffDocument` → panes → swap →
  dispose). Use real signatures from `ecucEditorProvider.ts`, `diffPanel.ts`, `webviewProtocol.ts`
  and `diffModel.ts`; do not copy Hex's memory/overlay/scripting lifecycle.
- **type-safety.md** — type ownership (`core/ecuc/model.ts`, `core/diff/diffModel.ts`,
  `webviewProtocol.ts`, page-local types), the host/webview boundary, discriminated unions, `unknown`
  at runtime boundaries, `import type`, CSS module declarations and forbidden `any`/blind assertions.

## Docs and examples

```text
docs/
├── README.md          index and links
├── ECUC_EDITOR.md     open, tree, details, editing, conditions, reveal, settings
└── DIFF.md            compare flow, what counts as a change, navigation, limitations
examples/
├── README.md          how to open it
└── synthetic-ecuc.arxml   small valid ECUC sample (not the 20 MiB manual file)
```

- Docs describe the shipped behaviour and link to the specs; examples are synthetic ARXML.
- The root `README.md` gets a `## Documentation` section linking `docs/` and `examples/`.
- `docs/` and `examples/` are small user-facing assets, so they ship in the VSIX; `.vscodeignore`
  needs no change.

## Rules

- Copy Hex Scope's section structure, never its hex examples or terminology.
- Every signature/claim must be checkable against the current source; link the file and symbol.
- Update the frontend index table and the components index; remove stale "to fill" text.
- No placeholder headings or "(To be filled)" text anywhere.

## Rollback

Docs-only child; revert the commit.
