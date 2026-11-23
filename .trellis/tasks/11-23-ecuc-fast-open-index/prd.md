# Open the ECUC editor before workspace indexing finishes

## Goal

Opening an `.arxml` file in the ECUC editor must show the editor immediately. Workspace-index
data (cross-file definitions, definition details and reference resolution) is enrichment, not a
prerequisite for the first paint. When indexing finishes, the already-open editor fills that
data in without a reload or a second visible open.

## Problem

The user reports that opening a file in the ECUC editor starts a workspace-indexing wait before
the editor appears. The extension currently starts `IndexService.rebuild()` during activation,
and the provider builds every row with the workspace `DefinitionSource`. That makes the first
paint depend on work that is allowed to arrive later.

## Requirements

- Measure the open path before changing it. Record, on a representative workspace with many
  `.arxml` files and one large file:
  - activation start/end and `resolveEngine` duration;
  - `IndexService.start()` time, rebuild start/end and event-loop lag;
  - command start, `resolveCustomTextEditor` start/end;
  - webview `ready` time;
  - first `push` start/end and `buildRows` duration with and without definitions;
  - engine `openDocument` duration.
- The editor tab and webview shell must appear without awaiting the workspace index.
- The first row document must not require `IndexService.rebuild()` or index readiness.
  - If the index has no usable snapshot yet, push rows without `definitions` and definition
    extras. The Document renders normally; Details omits definition rows.
  - If the index already has a usable snapshot (including during a later rebuild), use it.
- When the index finishes, completes with a failure, or is disabled, push **one** enriched row
  document and update Details. Preserve selection, scroll, collapsed rows and any local edit
  draft.
- No duplicate or looping refresh: the first build completion must not trigger a storm of
  `document` messages or repeated full row builds.
- Keep the extension host responsive while indexing. If measurement shows a long synchronous
  stretch, add cooperative yields at batch boundaries. Do not change the index result.
- Keep the existing text-editor features and cross-file behavior. The index remains memory-only;
  do not add a cache or a side file.
- Do not change the engine activation contract in this task unless measurement proves
  `resolveEngine` is the dominant blocker. The Rust engine remains required.
- Preserve the existing host protocol; a full `document` push after enrichment is acceptable.

## Acceptance Criteria

- [ ] A before/after timing report identifies the real blocker(s), not an assumption.
- [ ] With the workspace index disabled, the ECUC editor opens and renders its rows.
- [ ] With a forced slow index build, the editor opens and renders base rows before the index
      finishes; no blank tree and no boot warning.
- [ ] Definition/type/detail fields are absent while the index is unusable, then appear after
      completion, without a reload.
- [ ] Exactly one enriched `document` push follows the first completed build; no per-file or
      per-notification storm.
- [ ] Selection, scroll position and local edit drafts survive the enrichment push.
- [ ] A rebuild failure or a disabled index leaves the editor usable with base rows.
- [ ] The first paint target is met on the representative workspace (define the measured
      baseline and target in the task notes).
- [ ] Index tests, activation tests, full suite, preview audit and production bundle pass.

## Notes

- Follow-up on PR #40's `feat/ecuc-vscode-parity` branch.
- Ordering: start this task after
  `.trellis/tasks/11-23-direct-edit-string-shortname` is finished, so the editor-provider and
  preview changes do not overlap. The two tasks touch different layers, but the same PR.
- The index is optional and additive by design; see
  `.trellis/spec/frontend/quality-guidelines.md` ("Definition data is optional and additive"
  and "The workspace index is memory-only").
