//! Text and offset helpers shared by the scanner, the edit planner and the index.
//!
//! Offsets on the wire and in the model are **UTF-16 code units**, matching
//! `vscode.Position` and the TypeScript model this engine replaces. The scanner
//! walks bytes, so `SourceText` converts between the two. An ASCII document — the
//! overwhelmingly common case for ARXML — is the identity mapping and skips the
//! checkpoint table entirely.

/// UTF-16 offsets into the source text.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Range {
    pub start: u32,
    pub end: u32,
}

impl Range {
    pub fn new(start: usize, end: usize) -> Self {
        Self {
            start: start as u32,
            end: end as u32,
        }
    }
    pub fn contains(&self, offset: u32) -> bool {
        offset >= self.start && offset < self.end
    }
    pub fn len(&self) -> u32 {
        self.end.saturating_sub(self.start)
    }
    pub fn is_empty(&self) -> bool {
        self.end <= self.start
    }
}

/// One checkpoint of the UTF-16 <-> byte map: a byte offset and the UTF-16 offset there.
#[derive(Clone, Copy)]
struct Checkpoint {
    byte: u32,
    utf16: u32,
}

const CHECKPOINT_STRIDE: usize = 4096;

/// The retained document text plus the offset conversions the model needs.
pub struct SourceText {
    text: String,
    ascii: bool,
    checkpoints: Vec<Checkpoint>,
}

impl SourceText {
    pub fn new(text: String) -> Self {
        let ascii = text.is_ascii();
        let mut source = Self {
            text,
            ascii,
            checkpoints: Vec::new(),
        };
        if !source.ascii {
            source.build_checkpoints();
        }
        source
    }

    pub fn as_str(&self) -> &str {
        &self.text
    }

    pub fn is_ascii(&self) -> bool {
        self.ascii
    }

    pub fn byte_len(&self) -> usize {
        self.text.len()
    }

    /// Length in UTF-16 code units, the unit every range uses.
    pub fn len_utf16(&self) -> usize {
        if self.ascii {
            return self.text.len();
        }
        self.utf16_at_byte(self.text.len())
    }

    fn build_checkpoints(&mut self) {
        self.checkpoints.push(Checkpoint { byte: 0, utf16: 0 });
        let mut utf16 = 0u32;
        for (byte, ch) in self.text.char_indices() {
            if utf16 as usize >= self.checkpoints.len() * CHECKPOINT_STRIDE && byte > 0 {
                self.checkpoints.push(Checkpoint {
                    byte: byte as u32,
                    utf16,
                });
            }
            utf16 += ch.len_utf16() as u32;
        }
    }

    /// The UTF-16 offset of a byte offset.
    pub fn utf16_at_byte(&self, byte: usize) -> usize {
        if self.ascii {
            return byte;
        }
        let byte = byte.min(self.text.len());
        let index = self
            .checkpoints
            .partition_point(|c| (c.byte as usize) <= byte);
        let base = self.checkpoints[index.saturating_sub(1)];
        let mut utf16 = base.utf16 as usize;
        for ch in self.text[base.byte as usize..byte].chars() {
            utf16 += ch.len_utf16();
        }
        utf16
    }

    /// The byte offset of a UTF-16 offset, clamped into the text.
    pub fn byte_at_utf16(&self, offset: usize) -> usize {
        if self.ascii {
            return offset.min(self.text.len());
        }
        let offset = offset.min(self.len_utf16());
        let index = self
            .checkpoints
            .partition_point(|c| (c.utf16 as usize) <= offset);
        let base = self.checkpoints[index.saturating_sub(1)];
        let mut utf16 = base.utf16 as usize;
        for (byte, ch) in self.text[base.byte as usize..].char_indices() {
            let next = utf16 + ch.len_utf16();
            if next > offset {
                return base.byte as usize + byte;
            }
            utf16 = next;
        }
        self.text.len()
    }

    /// The slice between two UTF-16 offsets.
    pub fn slice_utf16(&self, start: usize, end: usize) -> &str {
        if self.ascii {
            let end = end.min(self.text.len());
            let start = start.min(end);
            return &self.text[start..end];
        }
        let start_byte = self.byte_at_utf16(start);
        let end_byte = self.byte_at_utf16(end);
        &self.text[start_byte..end_byte.max(start_byte)]
    }

    /// The slice between two byte offsets (scanner-internal use).
    pub fn slice_bytes(&self, start: usize, end: usize) -> &str {
        let end = end.min(self.text.len());
        let start = start.min(end);
        &self.text[start..end]
    }
}

/// UTF-16 length of a string, the unit `Range` uses.
pub fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// True for the four XML whitespace characters.
pub fn is_xml_whitespace(ch: u8) -> bool {
    matches!(ch, b' ' | b'\t' | b'\n' | b'\r')
}

/// Strips a namespace prefix from a tag or attribute name.
pub fn strip_xml_prefix(name: &str) -> &str {
    match name.rfind(':') {
        Some(colon) => &name[colon + 1..],
        None => name,
    }
}

/// Decodes the predefined and numeric XML entity references in `raw`.
pub fn decode_xml(raw: &str) -> String {
    if !raw.contains('&') {
        return raw.to_string();
    }
    let mut out = String::with_capacity(raw.len());
    let bytes = raw.as_bytes();
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] != b'&' {
            let next = raw[at..].chars().next().expect("in-bounds char");
            out.push(next);
            at += next.len_utf8();
            continue;
        }
        match entity_at(raw, at) {
            Some((body, end)) => {
                out.push_str(&decode_entity(body, &raw[at..end]));
                at = end;
            }
            None => {
                out.push('&');
                at += 1;
            }
        }
    }
    out
}

/// The entity body and the offset just past its `;`, when it matches the XML shape.
fn entity_at(raw: &str, amp: usize) -> Option<(&str, usize)> {
    let rest = &raw[amp + 1..];
    let end = rest.find(';')?;
    if end == 0 || end > 32 {
        return None;
    }
    let body = &rest[..end];
    let valid = match body.as_bytes()[0] {
        b'#' => {
            body[1..].chars().all(|c| c.is_ascii_hexdigit())
                || body[1..].chars().all(|c| c.is_ascii_digit())
        }
        first => first.is_ascii_alphabetic() && body.chars().all(|c| c.is_ascii_alphanumeric()),
    };
    valid.then(|| (body, amp + 1 + end + 1))
}

fn decode_entity(body: &str, whole: &str) -> String {
    if let Some(hex) = body.strip_prefix("#x").or_else(|| body.strip_prefix("#X")) {
        return code_point(hex, 16).unwrap_or_else(|| whole.to_string());
    }
    if let Some(decimal) = body.strip_prefix('#') {
        return code_point(decimal, 10).unwrap_or_else(|| whole.to_string());
    }
    match body {
        "amp" => "&".to_string(),
        "lt" => "<".to_string(),
        "gt" => ">".to_string(),
        "quot" => "\"".to_string(),
        "apos" => "'".to_string(),
        _ => whole.to_string(),
    }
}

fn code_point(digits: &str, radix: u32) -> Option<String> {
    let value = u32::from_str_radix(digits, radix).ok()?;
    char::from_u32(value).map(|ch| ch.to_string())
}

/// `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`, in that order.
pub fn escape_xml(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The offset just past a `<!DOCTYPE …>` declaration, including an internal subset
/// in brackets, or `usize::MAX` when the declaration is not complete yet.
pub fn markup_declaration_end(source: &str, at: usize) -> usize {
    let bytes = source.as_bytes();
    let mut quote: Option<u8> = None;
    let mut depth: i32 = 0;
    let mut index = at + 2;
    while index < bytes.len() {
        let ch = bytes[index];
        if let Some(open) = quote {
            if ch == open {
                quote = None;
            }
            index += 1;
            continue;
        }
        match ch {
            b'"' | b'\'' => quote = Some(ch),
            b'[' => depth += 1,
            b']' => depth -= 1,
            b'>' if depth <= 0 => return index + 1,
            _ => {}
        }
        index += 1;
    }
    usize::MAX
}

/// Schema release from `xsi:schemaLocation` (legacy §2.2).
pub fn schema_release_from(schema_location: &str) -> Option<String> {
    let last = schema_location.split_whitespace().last()?;
    if last.is_empty() {
        return None;
    }
    let before_dot = last.split('.').next().unwrap_or("");
    let parts: Vec<&str> = before_dot.split('_').collect();
    Some(parts.last()?.replace('-', "."))
}
