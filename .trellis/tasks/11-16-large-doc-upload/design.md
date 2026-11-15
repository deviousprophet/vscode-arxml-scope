# Large document upload — technical design

## Protocol

```
-> {id:1, op:"doc.open.begin", uri, options}
<- {id:1, ok:true, uploadId:7}

-> {id:2, op:"doc.open.chunk", uploadId:7, seq:0}  [raw 8 MiB]
<- {id:2, ok:true, received:8388608}

-> {id:3, op:"doc.open.end", uploadId:7}
<- {id:3, ok:true, docId:4, ecuc:true, modules:…, textLength:…}
```

`seq` is the zero-based index; the engine stores `next_seq` and rejects a mismatch.
The body length is the frame's `body.len()`; no base64.

`doc.resync.begin` stores the target `docId`; `end` calls `Document::resync` with the
assembled text and answers `ok`.

`upload.abort` removes the entry. The client sends it best-effort when a chunk fails
and ignores its error.

## Engine state

```rust
struct Upload {
    kind: UploadKind,          // Open { uri, options } | Resync { doc_id }
    bytes: Vec<u8>,
    next_seq: u32,
}
uploads: HashMap<u32, Upload>,
next_upload: u32,
```

`MAX_DOCUMENT_BYTES = 512 * 1024 * 1024`. A chunk that would exceed it returns
`code: "too_large"` and removes the upload.

`doc.open.end`:
1. `String::from_utf8(upload.bytes)` -> on error remove and return `invalid_utf8`.
2. Build `Document::with_options`, insert, respond with the same envelope as
   `doc.open`.
3. Remove the upload even on failure.

## Client

In `coreEngine.ts`:

```ts
const CHUNK = 8 * 1024 * 1024;
const MAX_DOCUMENT = 512 * 1024 * 1024;

async function openChunked(client, uri, text, options) {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= DATAGRAM_LIMIT) return client.request('doc.open', ...);
  if (bytes.length > MAX_DOCUMENT) throw new EngineError('document exceeds …', 'too_large');
  const begin = await client.request('doc.open.begin', { uri, options });
  const uploadId = begin.header.uploadId;
  try {
    for (let seq = 0, at = 0; at < bytes.length; seq++, at += CHUNK) {
      await client.request('doc.open.chunk', { uploadId, seq }, bytes.subarray(at, at + CHUNK));
    }
    return client.request('doc.open.end', { uploadId });
  } catch (error) {
    void client.request('upload.abort', { uploadId }).catch(() => undefined);
    throw error;
  }
}
```

`DATAGRAM_LIMIT = 56 MiB` leaves room for the header inside the 64 MiB frame.

The supervisor's replay path goes through `createEngine.openDocument`, so it gets
chunking for free after a crash.

## Tests

- Rust: `arxml-core` cannot test `main.rs`; add `#[cfg(test)]` helper functions for
  `Upload` assembly in `main.rs` (seq check, cap, UTF-8) and call them directly.
- TS `src/test/extension/engine.test.ts`:
  - build a 70 MiB document from a fixture header plus repeated comment blocks;
  - open through `EngineClient.openDocument` (new helper) or `createEngine`;
  - assert `textLength`, rows count > 0, and a diff against itself.
  - test gap/duplicate seq via raw requests.
- `scripts/engine-smoke.mjs`: open a small fixture, then a generated 2 MiB document
  through the chunked path with a 1 MiB chunk override to exercise multiple frames.

## Rollback

Additive ops and a client branch: reverting returns to the single-frame path. No
saved state exists outside a process.
