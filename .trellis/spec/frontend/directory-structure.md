# Directory Structure

## Layout

```
src/
  extension.ts        activation, registrations
  commands.ts         command handlers and the activation gate
  core/               pure logic. NO `vscode` imports. See the layering rule below.
    ecuc/             detect.ts  scanner.ts  model.ts  order.ts  resolve.ts  validate.ts
    text/             offsets.ts (line/offset index)
  editor/             the custom editor. May import `vscode`.
    ecucEditorProvider.ts   provider: gate, scan, render, wire, re-scan
    renderHtml.ts           the rendered page and the refreshable tree region
    navigation.ts           node <-> source range, reference following
    nodeId.ts               path-based node ids, stable across a re-scan
    filter.ts               filter matching, shared by both halves
    ecucEdit.ts             the edit record, region resolution, applyEdit
    ecucValueEditor.ts      the in-tree value widget (webview half)
  test/
    core/               core suites
    editor/             editor suites
    fixtures/           synthetic input fixtures (pinned `-text`)
    expected/           hand-authored expected models
    data/               gitignored: real files for local experimentation. Never commit.
  spikes/               throwaway Step 0 scaffolding, awaiting a manual run and then deletion
```

Build outputs, all gitignored: `dist/` (esbuild bundle of `src/extension.ts`) and `out/` (`tsc` output
used by the tests).

## The layering rule

**`src/core/**` must not import `vscode`.** Dependencies point one way:

```
extension.ts / commands.ts / editor/**  ──▶  core/**
```

`core/` is a pure library over text: detection, scanning, the information model, ordering, resolution,
validation and the offset index. Keeping `vscode` out of it is what would let the same code serve a
workspace index or a language server later, and it makes the core testable without a running editor.

Practical consequences:

- A core function takes text and returns data. It does not read files, resolve URIs, or know about
  workspaces.
- If a core module needs something from the editor, the answer is a parameter, not an import.
- The boundary is checked in review and in the parent acceptance criteria, not by the compiler — so
  check it with a grep when you touch core.

## Where new code goes

| Adding… | Goes in |
|---|---|
| Parsing, ordering, validation, anything over text | `src/core/` |
| Anything that touches a document, a panel, a command or a setting | `src/editor/` or `src/commands.ts` |
| A synthetic fixture for a core suite | `src/test/fixtures/` |
| A real file you want to try locally | `src/test/data/` (gitignored) |
