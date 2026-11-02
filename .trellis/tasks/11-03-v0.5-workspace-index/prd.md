# v0.5: streaming workspace index

## Problem

The extension scans one file per editor panel. There is no shared knowledge of the other ARXML files
in the workspace, so references, definitions and any later validation cannot resolve across files.

## Requirements

- **R1 — Streaming tokenizer.** A core XML tokenizer consumes text in arbitrary chunks and emits
  open/close/text events with absolute UTF-16 offsets. It handles a tag, attribute quote, comment,
  CDATA section, processing instruction or DOCTYPE split across chunk boundaries. No DOM, no
  `vscode`, no new dependency.
- **R2 — Index builder.** A core builder consumes tokenizer events and records, per file:
  - modules, containers and references with kind, AR path, short name, definition ref, UUID, range;
  - reference source path, raw target path and `DEST`;
  - `AR-PACKAGE` paths, so the same package split across files is observable;
  - ECUC definition elements with the metadata the definition child needs, so definitions are
    indexed once.
  The builder retains index records, not the source text.
- **R3 — Workspace index.** An in-memory index holds exactly one `FileIndex` per URI. Upserting a
  file replaces only that file's records; removing a file removes only its records. Stats expose
  file, element, reference and definition counts.
- **R4 — Discovery and reading.** The host indexes workspace `**/*.arxml` files through a Node read
  stream and a streaming `TextDecoder`; it does not load the whole file into one string. Files above
  `arxmlScope.index.maxFileSizeMB` are skipped and counted as skipped, never indexed partially.
- **R5 — Incremental refresh.** A `**/*.arxml` file watcher reindexes a created/changed file and
  removes a deleted one, with a short debounce so one save produces one update. Other files' entries
  are not rebuilt.
- **R6 — Status bar.** A status bar item reads `ARXML Scope: N files indexed` (N = indexed files) and
  is hidden when N is 0. Its tooltip lists elements, references, definitions and skipped files. While
  the first build runs it reads `ARXML Scope: indexing…`. Clicking it runs `ARXML Scope: Rebuild
  Workspace Index`. The item disappears when `arxmlScope.index.enabled` is false.
- **R7 — Settings.** `arxmlScope.index.enabled` (default `true`) and
  `arxmlScope.index.maxFileSizeMB` (default `50`, minimum `1`).
- **R8 — Change notification.** A core subscriber callback fires after every index change so the
  editor can re-render rows with definition data.
- **R9 — No side files.** Nothing is written beside a user file or anywhere on disk; the index is
  rebuilt on activation.

## Acceptance criteria

- A unit suite feeds one fixture through the tokenizer in 1-, 3-, 7- and whole-buffer chunks and gets
  identical events and offsets.
- A unit suite indexes a multi-file fixture set: module/container/parameter/reference paths, `DEST`,
  UUIDs, package paths and definition metadata are present; a duplicate AR path across files is
  reported as ambiguous by lookup instead of guessed.
- A unit suite upserts and removes files and checks that stats and lookups change only for that file.
- A host extension test indexes a temp workspace, reads the status-bar text through the extension
  API, edits one file and sees the indexed count and entry update, then deletes the file and sees the
  count drop.
- `npm run check-types`, `npm run lint` and `npm test` pass.
- No file is created beside the indexed fixtures.

## Out of scope

- Persisting the index.
- Cross-file reference navigation UI (v0.6).
- Parsing non-ARXML files.
