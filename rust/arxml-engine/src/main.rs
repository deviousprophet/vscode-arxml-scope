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

use arxml_core::ecuc::{edit, Document, RowOptions};
use serde_json::{json, Value};

const MAX_FRAME: usize = 64 * 1024 * 1024;
const ROWS_PER_CHUNK: usize = 4000;

struct Frame {
    header: Value,
    body: Vec<u8>,
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

struct Engine {
    documents: HashMap<u32, Document>,
    next_document: u32,
}

fn main() {
    let mut engine = Engine {
        documents: HashMap::new(),
        next_document: 1,
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
            "doc.close" => {
                let document = header.get("docId").and_then(Value::as_u64).unwrap_or(0) as u32;
                self.documents.remove(&document);
                write_frame(&mut out, &json!({"id": id, "ok": true}), &[])
                    .map_err(|error| error.to_string())
            }
            "doc.rows" => self.rows(id, &mut out, header),
            "doc.mergeIndex" => self.merge_index(id, &mut out, header),
            "doc.plan" => self.plan(id, &mut out, header),
            "doc.update" => self.update(id, &mut out, header),
            "doc.resync" => self.resync(id, &mut out, header, body),
            "doc.node" => self.node(id, &mut out, header),
            "doc.model" => self.model(id, &mut out, header),
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
        let options: RowOptions = header
            .get("options")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| error.to_string())?
            .unwrap_or_default();
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

    /// Streams one entry per node: id, parent, order, element range and own digest.
    fn merge_index(&mut self, id: u64, out: &mut impl Write, header: &Value) -> Result<(), String> {
        let document_id = doc_id(header)?;
        let document = self.documents.get(&document_id).ok_or("unknown document")?;
        let nodes = document.merge_index();
        let total = nodes.len();
        if total == 0 {
            return write_frame(
                out,
                &json!({"id": id, "ok": true, "chunk": {"seq": 0, "last": true, "total": 0}}),
                b"[]",
            )
            .map_err(|error| error.to_string());
        }
        let mut seq = 0usize;
        for chunk in nodes.chunks(ROWS_PER_CHUNK) {
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

fn doc_id(header: &Value) -> Result<u32, String> {
    header
        .get("docId")
        .and_then(Value::as_u64)
        .map(|value| value as u32)
        .ok_or_else(|| "docId is required".to_string())
}
