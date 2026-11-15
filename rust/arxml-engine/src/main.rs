//! The ARXML/ECUC engine process.
//!
//! Framed protocol over stdio: `[u32 LE payload_len][u16 LE header_len][header JSON]
//! [body bytes]`. The body carries document text and row JSON raw, so nothing is
//! escaped twice. The engine never writes a file; it answers plans, rows and row
//! patches, and the VS Code host applies them.
//!
//! One request is answered by one or more frames sharing its `id`; streaming
//! operations mark the last frame with `"chunk":{"last":true}`. A malformed frame
//! is a protocol error: the process exits 1 and the client restarts it.

use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};

use arxml_core::copy::{plan_copy, plan_delete, CopySpec};
use arxml_core::diff::patch::{patch_between, AppliedEdit, PatchOutcome, PatchSide};
use arxml_core::diff::{
    build_diff_document, DiffDocument, DiffHeader, DiffOptions, DiffSide, FileLabel,
};
use arxml_core::ecuc::{edit, Document, RowOptions};
use serde_json::{json, Value};

const MAX_FRAME: usize = 64 * 1024 * 1024;
const ROWS_PER_CHUNK: usize = 4000;
const MAX_DOCUMENT: usize = 512 * 1024 * 1024;

struct Frame {
    header: Value,
    body: Vec<u8>,
}

/// A chunked document upload; the body is assembled before it is decoded as UTF-8.
enum UploadKind {
    Open { options: RowOptions },
    Resync { doc_id: u32 },
}

struct Upload {
    kind: UploadKind,
    bytes: Vec<u8>,
    next_seq: u32,
}

fn read_frame(input: &mut impl Read) -> io::Result<Option<Frame>> {
    let mut len_bytes = [0u8; 4];
    match input.read_exact(&mut len_bytes) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }
    let len = u32::from_le_bytes(len_bytes) as usize;
    if !(2..=MAX_FRAME).contains(&len) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("bad frame length {len}"),
        ));
    }
    let mut payload = vec![0u8; len];
    input.read_exact(&mut payload)?;
    let header_len = u16::from_le_bytes([payload[0], payload[1]]) as usize;
    if header_len + 2 > payload.len() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "header length exceeds frame",
        ));
    }
    let header = serde_json::from_slice(&payload[2..2 + header_len])
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    Ok(Some(Frame {
        header,
        body: payload[2 + header_len..].to_vec(),
    }))
}

fn write_frame(out: &mut impl Write, header: &Value, body: &[u8]) -> io::Result<()> {
    let header = serde_json::to_vec(header)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    if header.len() > u16::MAX as usize {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "header too large",
        ));
    }
    let payload_len = 2 + header.len() + body.len();
    out.write_all(&(payload_len as u32).to_le_bytes())?;
    out.write_all(&(header.len() as u16).to_le_bytes())?;
    out.write_all(&header)?;
    out.write_all(body)?;
    out.flush()
}

/// The document `diff.patch` measures against, plus the text lengths it saw.
struct DiffBaseline {
    left_id: u32,
    right_id: u32,
    left_header: Value,
    right_header: Value,
    left_len: usize,
    right_len: usize,
    options: DiffOptions,
    document: DiffDocument,
}

struct Engine {
    documents: HashMap<u32, Document>,
    uploads: HashMap<u32, Upload>,
    next_document: u32,
    next_upload: u32,
    last_diff: Option<DiffBaseline>,
}

fn main() {
    let mut engine = Engine {
        documents: HashMap::new(),
        uploads: HashMap::new(),
        next_document: 1,
        next_upload: 1,
        last_diff: None,
    };
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    loop {
        let frame = match read_frame(&mut input) {
            Ok(Some(frame)) => frame,
            Ok(None) => break,
            Err(error) => {
                let _ = write_frame(
                    &mut out,
                    &json!({"ok": false, "fatal": "protocol", "reason": error.to_string()}),
                    &[],
                );
                std::process::exit(1);
            }
        };
        let id = frame.header.get("id").and_then(Value::as_u64).unwrap_or(0);
        let op = frame
            .header
            .get("op")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if op == "shutdown" {
            let _ = write_frame(&mut out, &json!({"id": id, "ok": true}), &[]);
            break;
        }
        let result = catch_unwind(AssertUnwindSafe(|| {
            engine.dispatch(id, &op, &frame.header, &frame.body)
        }));
        match result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                let _ = write_frame(
                    &mut out,
                    &json!({"id": id, "ok": false, "reason": error}),
                    &[],
                );
            }
            Err(_) => {
                let _ = write_frame(
                    &mut out,
                    &json!({"id": id, "ok": false, "code": "panic", "reason": "engine error during this operation"}),
                    &[],
                );
            }
        }
    }
}

impl Engine {
    fn dispatch(&mut self, id: u64, op: &str, header: &Value, body: &[u8]) -> Result<(), String> {
        let mut out = io::stdout().lock();
        match op {
            "hello" => write_frame(
                &mut out,
                &json!({
                    "id": id,
                    "ok": true,
                    "protocol": arxml_core::ENGINE_PROTOCOL,
                    "engine": arxml_core::engine_version(),
                }),
                &[],
            )
            .map_err(|error| error.to_string()),
            "doc.open" => self.open_document(id, &mut out, header, body),
            "doc.open.begin" => self.open_begin(id, &mut out, header),
            "doc.open.chunk" => self.upload_chunk(id, &mut out, header, body),
            "doc.open.end" => self.open_end(id, &mut out, header),
            "doc.resync.begin" => self.resync_begin(id, &mut out, header),
            "doc.resync.chunk" => self.upload_chunk(id, &mut out, header, body),
            "doc.resync.end" => self.resync_end(id, &mut out, header),
            "upload.abort" => self.upload_abort(id, &mut out, header),
            "doc.close" => {
                let document = header.get("docId").and_then(Value::as_u64).unwrap_or(0) as u32;
                self.documents.remove(&document);
                write_frame(&mut out, &json!({"id": id, "ok": true}), &[])
                    .map_err(|error| error.to_string())
            }
            "doc.rows" => self.rows(id, &mut out, header),
            "doc.plan" => self.plan(id, &mut out, header),
            "doc.update" => self.update(id, &mut out, header),
            "doc.resync" => self.resync(id, &mut out, header, body),
            "doc.node" => self.node(id, &mut out, header),
            "doc.model" => self.model(id, &mut out, header),
            "diff.compute" => self.diff_compute(id, &mut out, header),
            "diff.patch" => self.diff_patch(id, &mut out, header),
            "copy.plan" => self.copy_plan(id, &mut out, header),
            other => Err(format!("unknown operation {other}")),
        }
    }

    fn open_document(
        &mut self,
        id: u64,
        out: &mut impl Write,
        header: &Value,
        body: &[u8],
    ) -> Result<(), String> {
        let text = String::from_utf8(body.to_vec()).map_err(|_| "document body is not UTF-8")?;
        let options = row_options(header)?;
        self.store_document(id, out, text, options)
    }

    /// Creates the document and answers the same envelope for both open paths.
    fn store_document(
        &mut self,
        id: u64,
        out: &mut impl Write,
        text: String,
        options: RowOptions,
    ) -> Result<(), String> {
        let document_id = self.next_document;
        self.next_document += 1;
        let document = Document::with_options(text, options);
        let (modules, containers, parameters) = document.counts();
        let response = json!({
            "id": id,
            "ok": true,
            "docId": document_id,
            "ecuc": document.is_ecuc(),
            "modules": modules,
            "containers": containers,
            "parameters": parameters,
            "textLength": document.text_len(),
        });
        self.documents.insert(document_id, document);
        write_frame(out, &response, &[]).map_err(|error| error.to_string())
    }

    fn open_begin(&mut self, id: u64, out: &mut impl Write, header: &Value) -> Result<(), String> {
        let upload_id = self.next_upload;
        self.next_upload += 1;
        self.uploads.insert(
            upload_id,
            Upload {
                kind: UploadKind::Open {
                    options: row_options(header)?,
                },
                bytes: Vec::new(),
                next_seq: 0,
            },
        );
        write_frame(
            out,
            &json!({"id": id, "ok": true, "uploadId": upload_id}),
            &[],
        )
        .map_err(|error| error.to_string())
    }

    fn resync_begin(
        &mut self,
        id: u64,
        out: &mut impl Write,
        header: &Value,
    ) -> Result<(), String> {
        let document_id = doc_id(header)?;
        if !self.documents.contains_key(&document_id) {
            return Err("unknown document".to_string());
        }
        let upload_id = self.next_upload;
        self.next_upload += 1;
        self.uploads.insert(
            upload_id,
            Upload {
                kind: UploadKind::Resync {
                    doc_id: document_id,
                },
                bytes: Vec::new(),
                next_seq: 0,
            },
        );
        write_frame(
            out,
            &json!({"id": id, "ok": true, "uploadId": upload_id}),
            &[],
        )
        .map_err(|error| error.to_string())
    }

    fn upload_chunk(
        &mut self,
        id: u64,
        out: &mut impl Write,
        header: &Value,
        body: &[u8],
    ) -> Result<(), String> {
        let upload_id = header
            .get("uploadId")
            .and_then(Value::as_u64)
            .ok_or("uploadId is required")? as u32;
        let seq = header.get("seq").and_then(Value::as_u64).unwrap_or(0) as u32;
        let Some((expected, length)) = self
            .uploads
            .get(&upload_id)
            .map(|upload| (upload.next_seq, upload.bytes.len()))
        else {
            return Err("unknown upload".to_string());
        };
        if seq != expected {
            self.uploads.remove(&upload_id);
            return Err(format!("chunk {seq} out of order; expected {expected}"));
        }
        if length + body.len() > MAX_DOCUMENT {
            self.uploads.remove(&upload_id);
            return Err(format!(
                "document exceeds the {} MiB cap",
                MAX_DOCUMENT / (1024 * 1024)
            ));
        }
        let Some(upload) = self.uploads.get_mut(&upload_id) else {
            return Err("unknown upload".to_string());
        };
        upload.bytes.extend_from_slice(body);
        upload.next_seq += 1;
        let received = upload.bytes.len();
        let next_seq = upload.next_seq;
        write_frame(
            out,
            &json!({"id": id, "ok": true, "received": received, "nextSeq": next_seq}),
            &[],
        )
        .map_err(|error| error.to_string())
    }

    fn open_end(&mut self, id: u64, out: &mut impl Write, header: &Value) -> Result<(), String> {
        let upload_id = upload_id(header)?;
        let Some(upload) = self.uploads.remove(&upload_id) else {
            return Err("unknown upload".to_string());
        };
        let UploadKind::Open { options } = upload.kind else {
            return Err("upload is not a document open".to_string());
        };
        let text = String::from_utf8(upload.bytes).map_err(|_| "document body is not UTF-8")?;
        self.store_document(id, out, text, options)
    }

    fn resync_end(&mut self, id: u64, out: &mut impl Write, header: &Value) -> Result<(), String> {
        let upload_id = upload_id(header)?;
        let Some(upload) = self.uploads.remove(&upload_id) else {
            return Err("unknown upload".to_string());
        };
        let UploadKind::Resync { doc_id } = upload.kind else {
            return Err("upload is not a document resync".to_string());
        };
        let text = String::from_utf8(upload.bytes).map_err(|_| "document body is not UTF-8")?;
        let document = self.documents.get_mut(&doc_id).ok_or("unknown document")?;
        document.resync(text);
        write_frame(out, &json!({"id": id, "ok": true}), &[]).map_err(|error| error.to_string())
    }

    fn upload_abort(
        &mut self,
        id: u64,
        out: &mut impl Write,
        header: &Value,
    ) -> Result<(), String> {
        let upload_id = upload_id(header)?;
        self.uploads.remove(&upload_id);
        write_frame(out, &json!({"id": id, "ok": true}), &[]).map_err(|error| error.to_string())
    }

    fn rows(&mut self, id: u64, out: &mut impl Write, header: &Value) -> Result<(), String> {
        let document_id = doc_id(header)?;
        let options: RowOptions = header
            .get("options")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| error.to_string())?
            .unwrap_or_default();
        let document = self
            .documents
            .get_mut(&document_id)
            .ok_or("unknown document")?;
        document.set_options(options);
        let rows = document.rows();
        let total = rows.len();
        if total == 0 {
            return write_frame(
                out,
                &json!({"id": id, "ok": true, "chunk": {"seq": 0, "last": true, "total": 0}}),
                b"[]",
            )
            .map_err(|error| error.to_string());
        }
        let mut seq = 0usize;
        for chunk in rows.chunks(ROWS_PER_CHUNK) {
            let last = seq + chunk.len() >= total;
            let body = serde_json::to_vec(chunk).map_err(|error| error.to_string())?;
            write_frame(
                out,
                &json!({"id": id, "ok": true, "chunk": {"seq": seq, "last": last, "total": total}}),
                &body,
            )
            .map_err(|error| error.to_string())?;
            seq += chunk.len();
        }
        Ok(())
    }

    fn plan(&mut self, id: u64, out: &mut impl Write, header: &Value) -> Result<(), String> {
        let document_id = doc_id(header)?;
        let document = self.documents.get(&document_id).ok_or("unknown document")?;
        let node_id = header
            .get("nodeId")
            .and_then(Value::as_str)
            .ok_or("nodeId is required")?;
        let kind = header
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("value");
        let value = header.get("value").and_then(Value::as_str).unwrap_or("");
        let plan = match kind {
            "value" => edit::plan_value_edit(
                document.model(),
                document.index(),
                document.text(),
                node_id,
                value,
            ),
            "field" => edit::plan_field_edit(
                document.model(),
                document.index(),
                document.text(),
                node_id,
                header
                    .get("field")
                    .and_then(Value::as_str)
                    .unwrap_or("shortName"),
                value,
            ),
            other => return Err(format!("unknown plan kind {other}")),
        };
        let body = serde_json::to_vec(&plan).map_err(|error| error.to_string())?;
        write_frame(out, &json!({"id": id, "ok": true}), &body).map_err(|error| error.to_string())
    }

    fn update(&mut self, id: u64, out: &mut impl Write, header: &Value) -> Result<(), String> {
        let document_id = doc_id(header)?;
        let edits = header
            .get("edits")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let document = self
            .documents
            .get_mut(&document_id)
            .ok_or("unknown document")?;
        let mut changes: Vec<(usize, usize, String)> = Vec::new();
        for edit in edits {
            let start = edit.get("start").and_then(Value::as_u64).unwrap_or(0) as usize;
            let end = edit.get("end").and_then(Value::as_u64).unwrap_or(0) as usize;
            let text = edit
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            changes.push((start, end, text));
        }
        changes.sort_by_key(|change| std::cmp::Reverse(change.0));
        let patch = document.apply_changes(&changes);
        let (modules, containers, parameters) = document.counts();
        let body = serde_json::to_vec(&patch).map_err(|error| error.to_string())?;
        let response = json!({
            "id": id,
            "ok": true,
            "header": {"modules": modules, "containers": containers, "parameters": parameters},
        });
        write_frame(out, &response, &body).map_err(|error| error.to_string())
    }

    fn resync(
        &mut self,
        id: u64,
        out: &mut impl Write,
        header: &Value,
        body: &[u8],
    ) -> Result<(), String> {
        let document_id = doc_id(header)?;
        let text = String::from_utf8(body.to_vec()).map_err(|_| "document body is not UTF-8")?;
        let document = self
            .documents
            .get_mut(&document_id)
            .ok_or("unknown document")?;
        document.resync(text);
        write_frame(out, &json!({"id": id, "ok": true}), &[]).map_err(|error| error.to_string())
    }

    fn node(&mut self, id: u64, out: &mut impl Write, header: &Value) -> Result<(), String> {
        let document_id = doc_id(header)?;
        let document = self.documents.get(&document_id).ok_or("unknown document")?;
        let node_id = header.get("nodeId").and_then(Value::as_str).unwrap_or("");
        let entry = document.index().get(node_id);
        let response = match entry {
            Some(entry) => json!({
                "id": id,
                "ok": true,
                "node": {
                    "id": entry.id,
                    "kind": entry.kind.as_str(),
                    "label": entry.label,
                    "path": entry.path,
                    "range": {"start": entry.range.start, "end": entry.range.end},
                }
            }),
            None => json!({"id": id, "ok": true, "node": Value::Null}),
        };
        write_frame(out, &response, &[]).map_err(|error| error.to_string())
    }

    fn model(&mut self, id: u64, out: &mut impl Write, header: &Value) -> Result<(), String> {
        let document_id = doc_id(header)?;
        let document = self.documents.get(&document_id).ok_or("unknown document")?;
        let body = serde_json::to_vec(document.model()).map_err(|error| error.to_string())?;
        write_frame(out, &json!({"id": id, "ok": true}), &body).map_err(|error| error.to_string())
    }
}

/// The header lines a diff shows above one pane.
fn diff_header(document: &Document) -> DiffHeader {
    let model = document.model();
    DiffHeader {
        schema: model.schema.as_ref().map(|schema| schema.release.clone()),
        packages: model
            .packages
            .iter()
            .map(|package| package.path.join("."))
            .collect(),
    }
}

/// One side of `diff.compute`: the document handle plus the label the page shows.
fn diff_side(header: &Value, document: &Document) -> Result<(FileLabel, DiffHeader), String> {
    let name = header
        .get("name")
        .and_then(Value::as_str)
        .ok_or("name is required")?;
    let path = header.get("path").and_then(Value::as_str).unwrap_or(name);
    Ok((
        FileLabel {
            name: name.to_string(),
            path: path.to_string(),
        },
        diff_header(document),
    ))
}

impl Engine {
    /// Builds the diff for two open documents; the shared half of compute and patch.
    fn diff_document(
        &self,
        left_id: u32,
        right_id: u32,
        left_side: &Value,
        right_side: &Value,
        options: &DiffOptions,
    ) -> Result<DiffDocument, String> {
        let left = self
            .documents
            .get(&left_id)
            .ok_or("unknown left document")?;
        let right = self
            .documents
            .get(&right_id)
            .ok_or("unknown right document")?;
        let (left_label, left_inner) = diff_side(left_side, left)?;
        let (right_label, right_inner) = diff_side(right_side, right)?;
        let left_lookup = |id: &str| left.index().get(id).map(|entry| entry.range);
        let right_lookup = |id: &str| right.index().get(id).map(|entry| entry.range);
        Ok(build_diff_document(
            DiffSide {
                label: left_label,
                header: left_inner,
                rows: left.rows(),
                range: &left_lookup,
            },
            DiffSide {
                label: right_label,
                header: right_inner,
                rows: right.rows(),
                range: &right_lookup,
            },
            options,
        ))
    }

    fn copy_plan(&mut self, id: u64, out: &mut impl Write, header: &Value) -> Result<(), String> {
        let target_id = header
            .get("targetDocId")
            .and_then(Value::as_u64)
            .ok_or("targetDocId is required")? as u32;
        let target = self.documents.get(&target_id).ok_or("unknown document")?;
        let spec: CopySpec =
            serde_json::from_value(header.clone()).map_err(|error| error.to_string())?;
        let kind = header.get("kind").and_then(Value::as_str).unwrap_or("copy");
        let plan = if kind == "delete" {
            plan_delete(target.text(), spec.target)
        } else {
            let source_id = header
                .get("sourceDocId")
                .and_then(Value::as_u64)
                .ok_or("sourceDocId is required")? as u32;
            let source = self
                .documents
                .get(&source_id)
                .ok_or("unknown source document")?;
            plan_copy(target.text(), source.text(), &spec)
        };
        let body = serde_json::to_vec(&plan).map_err(|error| error.to_string())?;
        write_frame(out, &json!({"id": id, "ok": true}), &body).map_err(|error| error.to_string())
    }

    fn diff_compute(
        &mut self,
        id: u64,
        out: &mut impl Write,
        header: &Value,
    ) -> Result<(), String> {
        let left_side = header.get("left").cloned().ok_or("left is required")?;
        let right_side = header.get("right").cloned().ok_or("right is required")?;
        let left_id = left_side
            .get("docId")
            .and_then(Value::as_u64)
            .ok_or("left.docId is required")? as u32;
        let right_id = right_side
            .get("docId")
            .and_then(Value::as_u64)
            .ok_or("right.docId is required")? as u32;
        let options: DiffOptions = header
            .get("options")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| error.to_string())?
            .unwrap_or_default();
        let document = self.diff_document(left_id, right_id, &left_side, &right_side, &options)?;
        self.last_diff = Some(DiffBaseline {
            left_id,
            right_id,
            left_header: left_side,
            right_header: right_side,
            left_len: self
                .documents
                .get(&left_id)
                .map(Document::text_len)
                .unwrap_or(0),
            right_len: self
                .documents
                .get(&right_id)
                .map(Document::text_len)
                .unwrap_or(0),
            options,
            document,
        });
        let baseline = self.last_diff.as_ref().expect("just stored");
        stream_diff(out, id, &baseline.document)
    }

    /// One copy later: return the rows it changed, or why a rebuild is required.
    fn diff_patch(&mut self, id: u64, out: &mut impl Write, header: &Value) -> Result<(), String> {
        let left_side = header.get("left").ok_or("left is required")?;
        let right_side = header.get("right").ok_or("right is required")?;
        let left_id = left_side
            .get("docId")
            .and_then(Value::as_u64)
            .ok_or("left.docId is required")? as u32;
        let right_id = right_side
            .get("docId")
            .and_then(Value::as_u64)
            .ok_or("right.docId is required")? as u32;
        let edit = header.get("edit").ok_or("edit is required")?;
        let side = match edit.get("side").and_then(Value::as_str) {
            Some("left") => PatchSide::Left,
            Some("right") => PatchSide::Right,
            _ => return Err("edit.side must be left or right".to_string()),
        };
        let start = edit
            .get("start")
            .and_then(Value::as_u64)
            .ok_or("edit.start is required")? as u32;
        let end = edit
            .get("end")
            .and_then(Value::as_u64)
            .ok_or("edit.end is required")? as u32;
        if end < start {
            return Err("edit.end is before edit.start".to_string());
        }
        let text = edit.get("text").and_then(Value::as_str).unwrap_or("");
        let by = arxml_core::ecuc::text::utf16_len(text) as i64 - (end - start) as i64;
        let Some(baseline) = self.last_diff.take() else {
            return unpatchable(out, id, "no-baseline");
        };
        if baseline.left_id != left_id || baseline.right_id != right_id {
            return unpatchable(out, id, "no-baseline");
        }
        // The engine's text must have advanced by exactly the edit the host reports;
        // anything else means a change slipped past the panel.
        let left_len = self
            .documents
            .get(&left_id)
            .map(Document::text_len)
            .unwrap_or(0) as i64;
        let right_len = self
            .documents
            .get(&right_id)
            .map(Document::text_len)
            .unwrap_or(0) as i64;
        let expected_left = match side {
            PatchSide::Left => baseline.left_len as i64 + by,
            PatchSide::Right => baseline.left_len as i64,
        };
        let expected_right = match side {
            PatchSide::Right => baseline.right_len as i64 + by,
            PatchSide::Left => baseline.right_len as i64,
        };
        if left_len != expected_left || right_len != expected_right {
            self.last_diff = Some(baseline);
            return unpatchable(out, id, "stale-baseline");
        }
        let rebuilt = self.diff_document(
            left_id,
            right_id,
            &baseline.left_header,
            &baseline.right_header,
            &baseline.options,
        )?;
        let applied = AppliedEdit {
            side,
            start,
            end,
            by,
        };
        match patch_between(&baseline.document, &rebuilt, applied) {
            PatchOutcome::Patch(patch) => {
                // The next copy measures against the rebuilt document.
                self.last_diff = Some(DiffBaseline {
                    document: rebuilt,
                    ..baseline
                });
                // The patch is row data, so it travels in the body, not the header.
                let body = serde_json::to_vec(&patch).map_err(|error| error.to_string())?;
                write_frame(out, &json!({"id": id, "ok": true, "patch": true}), &body)
                    .map_err(|error| error.to_string())
            }
            PatchOutcome::Unpatchable(reason) => {
                self.last_diff = Some(baseline);
                unpatchable(out, id, reason)
            }
        }
    }
}

fn unpatchable(out: &mut impl Write, id: u64, reason: &str) -> Result<(), String> {
    write_frame(
        out,
        &json!({"id": id, "ok": true, "patch": Value::Null, "reason": reason}),
        &[],
    )
    .map_err(|error| error.to_string())
}

/// Row frames never carry the last flag: the envelope is the last frame, so a client
/// that resolves on the final chunk always has the headers and summary.
fn stream_diff(out: &mut impl Write, id: u64, document: &DiffDocument) -> Result<(), String> {
    let total = document.rows.len();
    let mut seq = 0usize;
    for chunk in document.rows.chunks(ROWS_PER_CHUNK) {
        let body = serde_json::to_vec(chunk).map_err(|error| error.to_string())?;
        write_frame(
            out,
            &json!({"id": id, "ok": true, "chunk": {"seq": seq, "last": false, "total": total}}),
            &body,
        )
        .map_err(|error| error.to_string())?;
        seq += chunk.len();
    }
    let envelope = json!({
        "id": id,
        "ok": true,
        "chunk": {"seq": total, "last": true, "total": total},
        "document": {
            "left": document.left,
            "right": document.right,
            "leftHeader": document.left_header,
            "rightHeader": document.right_header,
            "labels": document.labels,
            "summary": document.summary,
            "semanticSkipped": document.semantic_skipped,
            "semanticLimitReason": document.semantic_limit_reason,
        }
    });
    write_frame(out, &envelope, &[]).map_err(|error| error.to_string())
}

fn doc_id(header: &Value) -> Result<u32, String> {
    header
        .get("docId")
        .and_then(Value::as_u64)
        .map(|value| value as u32)
        .ok_or_else(|| "docId is required".to_string())
}

fn upload_id(header: &Value) -> Result<u32, String> {
    header
        .get("uploadId")
        .and_then(Value::as_u64)
        .map(|value| value as u32)
        .ok_or_else(|| "uploadId is required".to_string())
}

fn row_options(header: &Value) -> Result<RowOptions, String> {
    header
        .get("options")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|error| error.to_string())
        .map(|options| options.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> Engine {
        Engine {
            documents: HashMap::new(),
            uploads: HashMap::new(),
            next_document: 1,
            next_upload: 1,
            last_diff: None,
        }
    }

    #[test]
    fn chunked_open_assembles_utf8_across_a_split_character() {
        let mut engine = engine();
        let mut out = Vec::new();
        engine
            .open_begin(1, &mut out, &json!({"options": {"sort": "all"}}))
            .unwrap();
        let text = "é-data";
        let bytes = text.as_bytes();
        engine
            .upload_chunk(2, &mut out, &json!({"uploadId": 1, "seq": 0}), &bytes[..1])
            .unwrap();
        engine
            .upload_chunk(3, &mut out, &json!({"uploadId": 1, "seq": 1}), &bytes[1..])
            .unwrap();
        engine
            .open_end(4, &mut out, &json!({"uploadId": 1}))
            .unwrap();
        assert_eq!(engine.documents.get(&1).unwrap().text().as_str(), text);
        assert!(engine.uploads.is_empty());
    }

    #[test]
    fn out_of_order_chunk_removes_the_upload() {
        let mut engine = engine();
        let mut out = Vec::new();
        engine.open_begin(1, &mut out, &json!({})).unwrap();
        let error = engine
            .upload_chunk(2, &mut out, &json!({"uploadId": 1, "seq": 1}), b"x")
            .unwrap_err();
        assert!(error.contains("out of order"));
        assert!(engine.uploads.is_empty());
        assert!(engine
            .upload_chunk(3, &mut out, &json!({"uploadId": 1, "seq": 0}), b"x")
            .is_err());
    }

    #[test]
    fn invalid_utf8_at_end_leaves_no_document() {
        let mut engine = engine();
        let mut out = Vec::new();
        engine.open_begin(1, &mut out, &json!({})).unwrap();
        engine
            .upload_chunk(2, &mut out, &json!({"uploadId": 1, "seq": 0}), &[0xff])
            .unwrap();
        let error = engine
            .open_end(3, &mut out, &json!({"uploadId": 1}))
            .unwrap_err();
        assert!(error.contains("UTF-8"));
        assert!(engine.documents.is_empty());
        assert!(engine.uploads.is_empty());
    }

    #[test]
    fn chunked_resync_replaces_the_document_text() {
        let mut engine = engine();
        let mut out = Vec::new();
        engine
            .store_document(1, &mut out, "old".to_string(), RowOptions::default())
            .unwrap();
        engine
            .resync_begin(2, &mut out, &json!({"docId": 1}))
            .unwrap();
        engine
            .upload_chunk(3, &mut out, &json!({"uploadId": 1, "seq": 0}), b"new")
            .unwrap();
        engine
            .resync_end(4, &mut out, &json!({"uploadId": 1}))
            .unwrap();
        assert_eq!(engine.documents.get(&1).unwrap().text().as_str(), "new");
    }
}
