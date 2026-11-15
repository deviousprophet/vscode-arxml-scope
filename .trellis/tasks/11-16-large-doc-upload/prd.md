# Large document upload

## Goal

Let documents larger than the 64 MiB frame limit reach the engine, without raising
the single-frame limit and without a second copy of the text in a request buffer.

## Requirements

- Add a chunked upload to the protocol:
  - `doc.open.begin` {uri, options} -> {uploadId}
  - `doc.open.chunk` {uploadId, seq} body raw bytes -> {received}
  - `doc.open.end` {uploadId} -> the existing open response
  - `doc.resync.begin/chunk/end` for a full text refresh
  - `upload.abort` {uploadId}
- Keep `doc.open` and `doc.resync` single-frame operations for small documents and
  existing tests. `CoreEngine.openDocument` chooses chunked automatically.
- Chunk size is 8 MiB of UTF-8 bytes. Chunk boundaries may split a multi-byte
  character; the engine assembles bytes before `String::from_utf8`.
- Reject: wrong `seq`, unknown `uploadId`, a chunk after the last one, an upload
  above the document cap, and invalid UTF-8 at `end`.
- The document cap is 512 MiB. Above it, the client refuses with a clear message and
  the engine reports `code: "too_large"`.
- A failed upload must not leak the buffer; `upload.abort` and process exit clear it.
- The diff path only needs document ids, so a chunk-opened document diffs unchanged.

## Acceptance criteria

- [ ] `EngineClient` can open a 70 MiB ECUC document; its `textLength` equals the
      UTF-8 byte length-independent UTF-16 length the engine reports.
- [ ] The same document diffs against an edited copy.
- [ ] A chunk sequence with a gap or duplicate is rejected and the upload removed.
- [ ] A single frame above 64 MiB still fails before writing to the engine.
- [ ] `doc.open` (single frame) still opens fixtures and all existing engine tests
      pass.
- [ ] `engine:smoke` exercises a chunked open.
- [ ] Rust unit tests cover upload assembly and rejection; TypeScript engine tests
      cover the client chunking and the state machine.
- [ ] No document text is JSON-escaped; chunks stay raw bytes.

## Constraints

- Protocol stays additive and version `1`.
- The engine still answers one request per frame id; chunks are separate request ids.
- Do not remove `MAX_FRAME`; chunk sizes must stay safely below it.
