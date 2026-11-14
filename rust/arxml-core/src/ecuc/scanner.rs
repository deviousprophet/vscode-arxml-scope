//! Single-pass, iterative ECUC-Values scanner.
//!
//! Hand-written lexer plus an element stack. No DOM, no recursion: nesting depth
//! cannot overflow the call stack. This is a port of `core/ecuc/scanner.ts`; the
//! behaviour, including its treatment of malformed input, is intentionally
//! identical, and `engineParity` compares the two over the fixture corpus.

use std::collections::HashMap;

use super::model::{
    last_short_name, structify, Annotation, ContainerNode, EcucDocumentModel, ModuleNode,
    PackageEntry, ParameterNode, PathIndex, PostBuildVariant, ReferenceNode, Suffixes,
};
use super::text::{
    decode_xml, is_xml_whitespace, markup_declaration_end, schema_release_from, strip_xml_prefix,
    Range, SourceText,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RecKind {
    Autosar,
    Package,
    Module,
    Container,
    Param,
    Reference,
    Text,
    Value,
    PbConditions,
    PbCondition,
    Annotations,
    Annotation,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ValueRole {
    Param,
    Pb,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Attr {
    None,
    DefinitionRef,
    ValueRef,
    TargetRef,
}

#[derive(Default)]
struct Rec {
    kind: Option<RecKind>,
    name: String,
    range: Option<Range>,
    attrs: Option<HashMap<String, String>>,
    definition_ref: Option<String>,
    definition_ref_range: Option<Range>,
    definition_dest: Option<String>,
    target_dest: Option<String>,
    short_name: Option<String>,
    short_name_range: Option<Range>,
    variant: Option<String>,
    variant_range: Option<Range>,
    container_path: Option<Vec<String>>,
    display_value: Option<String>,
    value_range: Option<Range>,
    numeric: bool,
    instance: bool,
    target_raw: Option<String>,
    target_path: Option<String>,
    target_range: Option<Range>,
    context_raw: Vec<String>,
    context_paths: Option<Vec<String>>,
    criterion_raw: Option<String>,
    pb_value_raw: Option<String>,
    syscond: Option<String>,
    syscond_range: Option<Range>,
    pb_variants: Option<Vec<PostBuildVariant>>,
    post_build_range: Option<Range>,
    label: Option<String>,
    text: Option<String>,
    annotations: Option<Vec<Annotation>>,
    parameters: Vec<Rec>,
    references: Vec<Rec>,
    containers: Vec<Rec>,
}

impl Rec {
    fn new(kind: RecKind, name: &str) -> Self {
        Self {
            kind: Some(kind),
            name: name.to_string(),
            ..Default::default()
        }
    }

    fn kind(&self) -> RecKind {
        self.kind.expect("a recorded element always has a kind")
    }

    fn suffixes(&self) -> Suffixes {
        Suffixes {
            syscond: self.syscond.clone(),
            syscond_range: self.syscond_range,
            post_build_variants: self.pb_variants.clone(),
            post_build_range: self.post_build_range,
            annotations: self.annotations.clone(),
        }
    }
}

struct Entry {
    name: String,
    start: usize,
    text: String,
    /// UTF-16 offset of the first captured character, or -1.
    text_start: i64,
    /// UTF-16 offset just past the last captured character, or -1.
    text_end: i64,
    rec: Option<Rec>,
    attrs: Option<HashMap<String, String>>,
    value_role: Option<ValueRole>,
}

/// The text-bearing half of a closed element, passed to the record finalizers.
struct TextCtx {
    #[allow(dead_code)]
    name: String,
    text: String,
    text_start: i64,
    text_end: i64,
    attrs: Option<HashMap<String, String>>,
    value_role: Option<ValueRole>,
}

const TEXT_TAGS: [&str; 10] = [
    "SHORT-NAME",
    "DEFINITION-REF",
    "IMPLEMENTATION-CONFIG-VARIANT",
    "SW-SYSCOND",
    "MATCHING-CRITERION-REF",
    "L-4",
    "L-5",
    "VALUE-REF",
    "TARGET-REF",
    "CONTEXT-ELEMENT-REF",
];

const NODE_KINDS: [RecKind; 4] = [
    RecKind::Module,
    RecKind::Container,
    RecKind::Param,
    RecKind::Reference,
];

/// A run of captured text with its absolute byte bounds.
struct Run<'a> {
    chunk: &'a str,
    start: usize,
    end: usize,
}

struct TagStop {
    end: usize,
    self_closing: bool,
}

struct Scanner<'a> {
    src: &'a SourceText,
    text: &'a str,
    len: usize,
    at: usize,
    stack: Vec<Entry>,
    model: EcucDocumentModel,
    package_ranges: HashMap<String, Range>,
    pending_packages: Vec<Vec<String>>,
}

/// Scans an ECUC-Values ARXML text into its ARTEXT model.
pub fn scan_ecuc_values(text: String) -> EcucDocumentModel {
    let src = SourceText::new(text);
    let mut scanner = Scanner {
        src: &src,
        text: src.as_str(),
        len: src.as_str().len(),
        at: 0,
        stack: Vec::new(),
        model: EcucDocumentModel {
            path_index: PathIndex::default(),
            ..Default::default()
        },
        package_ranges: HashMap::new(),
        pending_packages: Vec::new(),
    };
    scanner.scan_all();
    for chain in scanner.pending_packages.clone() {
        let key = format!("/{}", chain.join("/"));
        if let Some(range) = scanner.package_ranges.get(&key).copied() {
            scanner
                .model
                .packages
                .push(PackageEntry { path: chain, range });
        }
    }
    scanner.model
}

impl<'a> Scanner<'a> {
    fn bytes(&self) -> &'a [u8] {
        self.text.as_bytes()
    }

    fn skip_whitespace(&self, from: usize) -> usize {
        let bytes = self.bytes();
        let mut at = from;
        while at < self.len && is_xml_whitespace(bytes[at]) {
            at += 1;
        }
        at
    }

    fn leading_whitespace(raw: &str) -> usize {
        raw.bytes().take_while(|b| is_xml_whitespace(*b)).count()
    }

    fn trailing_whitespace(raw: &str, leading: usize) -> usize {
        let bytes = raw.as_bytes();
        let mut at = 0;
        while at < raw.len() - leading && is_xml_whitespace(bytes[raw.len() - 1 - at]) {
            at += 1;
        }
        at
    }

    /// The formatted run of a `SW-SYSCOND`, or the raw run for every other element.
    /// Appends raw characters `[from, to)` to the innermost open element.
    fn append(&mut self, raw: &str, from: usize, to: usize) {
        let Some(entry) = self.stack.last_mut() else {
            return;
        };
        let run = {
            let name = entry.name.clone();
            Self::captured_run_named(&name, raw, from, to)
        };
        if run.chunk.is_empty() {
            return;
        }
        entry.text.push_str(run.chunk);
        if entry.text_start < 0 {
            entry.text_start = self.src.utf16_at_byte(run.start) as i64;
        }
        entry.text_end = self.src.utf16_at_byte(run.end) as i64;
    }

    fn captured_run_named<'b>(name: &str, raw: &'b str, from: usize, to: usize) -> Run<'b> {
        if name != "SW-SYSCOND" {
            return Run {
                chunk: raw,
                start: from,
                end: to,
            };
        }
        let leading = Self::leading_whitespace(raw);
        let trailing = Self::trailing_whitespace(raw, leading);
        Run {
            chunk: &raw[leading..raw.len() - trailing],
            start: from + leading,
            end: to - trailing,
        }
    }

    fn is_name_stop(ch: u8) -> bool {
        is_xml_whitespace(ch) || ch == b'>' || ch == b'/'
    }

    fn is_attribute_name_stop(ch: u8) -> bool {
        Self::is_name_stop(ch) || ch == b'='
    }

    fn read_name(&self, from: usize) -> (String, usize) {
        let bytes = self.bytes();
        let mut at = from;
        while at < self.len && !Self::is_name_stop(bytes[at]) {
            at += 1;
        }
        (
            strip_xml_prefix(self.text.get(from..at).unwrap_or("")).to_string(),
            at,
        )
    }

    fn read_attribute_name(&self, from: usize) -> (String, usize) {
        let bytes = self.bytes();
        let mut at = from;
        while at < self.len && !Self::is_attribute_name_stop(bytes[at]) {
            at += 1;
        }
        (
            strip_xml_prefix(self.text.get(from..at).unwrap_or("")).to_string(),
            at,
        )
    }

    fn read_bare_value(&self, from: usize) -> (String, usize) {
        let bytes = self.bytes();
        let mut at = from;
        while at < self.len && !is_xml_whitespace(bytes[at]) && bytes[at] != b'>' {
            at += 1;
        }
        (self.text.get(from..at).unwrap_or("").to_string(), at)
    }

    fn read_quoted_value(&self, from: usize, quote: u8) -> (String, usize) {
        let bytes = self.bytes();
        let mut at = from + 1;
        while at < self.len && bytes[at] != quote {
            at += 1;
        }
        (
            self.text.get(from + 1..at).unwrap_or("").to_string(),
            if at < self.len { at + 1 } else { at },
        )
    }

    fn read_attribute_value(&self, from: usize) -> (String, usize) {
        match self.bytes().get(from) {
            Some(&quote @ (b'"' | b'\'')) => self.read_quoted_value(from, quote),
            _ => self.read_bare_value(from),
        }
    }

    fn read_attribute(&self, from: usize, attrs: &mut HashMap<String, String>) -> usize {
        let (name, end) = self.read_attribute_name(from);
        let after_name = self.skip_whitespace(end);
        if self.bytes().get(after_name) != Some(&b'=') {
            if !name.is_empty() {
                attrs.insert(name, String::new());
            }
            return after_name;
        }
        let (value, end) = self.read_attribute_value(self.skip_whitespace(after_name + 1));
        attrs.insert(name, value);
        end
    }

    fn tag_stop(&self, at: usize) -> Option<TagStop> {
        match self.bytes().get(at) {
            Some(b'>') => Some(TagStop {
                end: at + 1,
                self_closing: false,
            }),
            Some(b'/') => {
                let closes = self.bytes().get(at + 1) == Some(&b'>');
                Some(TagStop {
                    end: if closes { at + 2 } else { at + 1 },
                    self_closing: closes,
                })
            }
            Some(_) => None,
            None => Some(TagStop {
                end: at,
                self_closing: false,
            }),
        }
    }

    fn read_attributes(&self, from: usize, attrs: &mut HashMap<String, String>) -> TagStop {
        let mut at = from;
        while at < self.len {
            let skipped = self.skip_whitespace(at);
            if let Some(stop) = self.tag_stop(skipped) {
                return stop;
            }
            at = self.read_attribute(skipped, attrs);
        }
        TagStop {
            end: at,
            self_closing: false,
        }
    }

    fn keeps_attributes(name: &str) -> Attr {
        match name {
            "DEFINITION-REF" => Attr::DefinitionRef,
            "VALUE-REF" => Attr::ValueRef,
            "TARGET-REF" => Attr::TargetRef,
            _ => Attr::None,
        }
    }

    fn open_record(&self, name: &str, attrs: &HashMap<String, String>) -> Option<Rec> {
        if let Some(rec) = node_record(name) {
            return Some(rec);
        }
        if name == "AUTOSAR" {
            return Some(Rec {
                attrs: Some(attrs.clone()),
                ..Rec::new(RecKind::Autosar, name)
            });
        }
        if name == "AR-PACKAGE" {
            return Some(Rec::new(RecKind::Package, name));
        }
        if let Some(kind) = match name {
            "POST-BUILD-VARIANT-CONDITIONS" => Some(RecKind::PbConditions),
            "POST-BUILD-VARIANT-CONDITION" => Some(RecKind::PbCondition),
            "ANNOTATIONS" => Some(RecKind::Annotations),
            "ANNOTATION" => Some(RecKind::Annotation),
            "VALUE" => Some(RecKind::Value),
            _ => None,
        } {
            return Some(Rec::new(kind, name));
        }
        if TEXT_TAGS.contains(&name) {
            return Some(Rec::new(RecKind::Text, name));
        }
        None
    }

    fn open_element(
        &mut self,
        name: &str,
        start: usize,
        end: usize,
        attrs: HashMap<String, String>,
        self_closing: bool,
    ) {
        let mut entry = Entry {
            name: name.to_string(),
            start,
            text: String::new(),
            text_start: -1,
            text_end: -1,
            rec: self.open_record(name, &attrs),
            attrs: None,
            value_role: None,
        };
        if Self::keeps_attributes(name) != Attr::None {
            entry.attrs = Some(attrs.clone());
        }
        if entry
            .rec
            .as_ref()
            .map(|r| r.kind() == RecKind::Value)
            .unwrap_or(false)
        {
            entry.value_role = self.value_role();
        }
        self.stack.push(entry);
        if self_closing {
            self.close_element(name, end);
        }
    }

    fn value_role(&self) -> Option<ValueRole> {
        match self.stack.last().map(|e| e.name.as_str()) {
            Some("ECUC-NUMERICAL-PARAM-VALUE") | Some("ECUC-TEXTUAL-PARAM-VALUE") => {
                Some(ValueRole::Param)
            }
            Some("POST-BUILD-VARIANT-CONDITION") => Some(ValueRole::Pb),
            _ => None,
        }
    }

    fn read_tag(&mut self, at: usize) -> usize {
        let start = at;
        let closing = self.bytes().get(at + 1) == Some(&b'/');
        let (name, name_end) = self.read_name(if closing { at + 2 } else { at + 1 });
        let mut attrs = HashMap::new();
        let tail = self.read_attributes(name_end, &mut attrs);
        if closing {
            self.close_element(&name, tail.end);
        } else {
            self.open_element(&name, start, tail.end, attrs, tail.self_closing);
        }
        tail.end
    }

    fn find_open_element(&self, name: &str) -> Option<usize> {
        self.stack.iter().rposition(|entry| entry.name == name)
    }

    fn close_element(&mut self, name: &str, end: usize) {
        let Some(index) = self.find_open_element(name) else {
            return;
        };
        let closing = self.stack.split_off(index);
        for entry in closing.into_iter().rev() {
            self.finish(entry, end);
        }
    }

    fn finish(&mut self, entry: Entry, end: usize) {
        let Entry {
            name,
            start,
            text,
            text_start,
            text_end,
            rec,
            attrs,
            value_role,
        } = entry;
        if name == "SYSC-REF" {
            self.finish_sysc_ref(&text, text_start, start);
            return;
        }
        let ctx = TextCtx {
            name,
            text,
            text_start,
            text_end,
            attrs,
            value_role,
        };
        let Some(mut rec) = rec else { return };
        rec.range = Some(Range::new(start, end));
        self.finish_record(rec, &ctx);
    }

    /// A condition can name a system constant inline; substitute the path tail where it stood.
    fn finish_sysc_ref(&mut self, text: &str, text_start: i64, start: usize) {
        let tail = last_short_name(text.trim()).to_string();
        let Some(holder) = self.stack.last_mut() else {
            return;
        };
        if holder.name != "SW-SYSCOND" {
            return;
        }
        holder.text.push_str(&tail);
        let at = if tail.is_empty() {
            None
        } else {
            text.rfind(&tail)
        };
        let anchor = match at {
            Some(byte_index) if text_start >= 0 => {
                text_start as usize + super::text::utf16_len(&text[..byte_index])
            }
            _ => start,
        };
        if holder.text_start < 0 {
            holder.text_start = anchor as i64;
        }
        holder.text_end = (anchor + super::text::utf16_len(&tail)) as i64;
    }

    fn finish_record(&mut self, rec: Rec, entry: &TextCtx) {
        match rec.kind() {
            RecKind::Package | RecKind::Module | RecKind::Container => self.finish_node(rec),
            RecKind::Text => self.finish_text(rec, entry),
            RecKind::Param => self.finish_param(rec, entry),
            RecKind::Reference => self.finish_reference(rec),
            RecKind::Autosar => {
                if let Some(location) = rec.attrs.as_ref().and_then(|a| a.get("schemaLocation")) {
                    if let Some(release) = schema_release_from(location) {
                        self.model.schema = Some(super::model::SchemaRelease { release });
                    }
                }
            }
            RecKind::Value => self.finish_value(rec, entry),
            RecKind::PbConditions => {
                if let Some(index) = self.nearest(&NODE_KINDS) {
                    if let Some(parent) = self.rec_mut(index) {
                        parent.post_build_range = rec.range;
                    }
                }
            }
            RecKind::PbCondition => {
                if let Some(index) = self.nearest(&NODE_KINDS) {
                    let variant = PostBuildVariant {
                        criterion: last_short_name(rec.criterion_raw.as_deref().unwrap_or(""))
                            .to_string(),
                        operator: "==".to_string(),
                        value: rec.pb_value_raw.as_deref().unwrap_or("").trim().to_string(),
                    };
                    if let Some(parent) = self.rec_mut(index) {
                        parent
                            .pb_variants
                            .get_or_insert_with(Vec::new)
                            .push(variant);
                    }
                }
            }
            RecKind::Annotation => {
                let parent = self.nearest_kind(RecKind::Annotations);
                if let Some(parent) = parent {
                    let annotation = Annotation {
                        label: rec.label,
                        text: rec.text,
                        range: rec.range,
                    };
                    if let Some(parent) = self.rec_mut(parent) {
                        parent
                            .annotations
                            .get_or_insert_with(Vec::new)
                            .push(annotation);
                    }
                }
            }
            RecKind::Annotations => {
                if let Some(index) = self.nearest(&NODE_KINDS) {
                    if let Some(annotations) = rec.annotations {
                        if !annotations.is_empty() {
                            if let Some(parent) = self.rec_mut(index) {
                                parent.annotations = Some(annotations);
                            }
                        }
                    }
                }
            }
        }
    }

    fn finish_param(&mut self, mut rec: Rec, entry: &TextCtx) {
        if rec.display_value.is_none() {
            rec.display_value = Some(decode_xml(&entry.text).trim().to_string());
        }
        self.attach_child(rec);
    }

    fn finish_reference(&mut self, mut rec: Rec) {
        rec.target_raw = Some(rec.target_raw.as_deref().unwrap_or("").trim().to_string());
        rec.target_path = Some(structify(rec.target_raw.as_deref().unwrap_or("")));
        rec.context_paths = Some(rec.context_raw.iter().map(|path| structify(path)).collect());
        rec.context_raw.clear();
        self.attach_child(rec);
    }

    fn finish_node(&mut self, rec: Rec) {
        let pkg_chain = self.ancestor_short_names(&[RecKind::Package]);
        let short_name = rec.short_name.clone().unwrap_or_default();
        match rec.kind() {
            RecKind::Package => {
                let mut chain = pkg_chain;
                chain.push(short_name);
                if let Some(range) = rec.range {
                    let key = format!("/{}", chain.join("/"));
                    self.model.path_index.add(key.clone(), range);
                    self.package_ranges.insert(key, range);
                }
            }
            RecKind::Module => {
                if let Some(range) = rec.range {
                    let mut chain = pkg_chain.clone();
                    chain.push(short_name.clone());
                    self.model
                        .path_index
                        .add(format!("/{}", chain.join("/")), range);
                }
                let suffixes = rec.suffixes();
                let containers = self.take_containers(rec.containers);
                self.model.modules.push(ModuleNode {
                    kind: "module".to_string(),
                    definition_ref: rec.definition_ref.clone().unwrap_or_default(),
                    definition_ref_range: rec.definition_ref_range,
                    short_name,
                    short_name_range: rec.short_name_range,
                    variant: rec.variant.clone(),
                    variant_range: rec.variant_range,
                    range: rec.range.unwrap_or_default(),
                    containers,
                    suffixes,
                });
                if !pkg_chain.is_empty() {
                    self.remember_package(pkg_chain);
                }
            }
            RecKind::Container => self.finish_container(rec, pkg_chain, short_name),
            _ => {}
        }
    }

    fn remember_package(&mut self, chain: Vec<String>) {
        let key = chain.join("/");
        if !self
            .pending_packages
            .iter()
            .any(|existing| existing.join("/") == key)
        {
            self.pending_packages.push(chain);
        }
    }

    fn finish_container(&mut self, mut rec: Rec, pkg_chain: Vec<String>, short_name: String) {
        let module_short_name = self
            .nearest(&[RecKind::Module])
            .and_then(|index| self.stack[index].rec.as_ref())
            .and_then(|module| module.short_name.clone())
            .unwrap_or_default();
        let container_chain = self.ancestor_short_names(&[RecKind::Container]);
        let mut path = pkg_chain;
        path.push(module_short_name);
        path.extend(container_chain);
        rec.container_path = Some(path.clone());
        if let Some(range) = rec.range {
            path.push(short_name);
            self.model
                .path_index
                .add(format!("/{}", path.join("/")), range);
        }
        self.attach_child(rec);
    }

    fn attach_child(&mut self, rec: Rec) {
        let parent = self
            .nearest(&[RecKind::Container])
            .or_else(|| self.nearest(&[RecKind::Module]));
        let Some(index) = parent else { return };
        let kind = rec.kind();
        if let Some(parent) = self.rec_mut(index) {
            match kind {
                RecKind::Container => parent.containers.push(rec),
                RecKind::Param => parent.parameters.push(rec),
                RecKind::Reference => parent.references.push(rec),
                _ => {}
            }
        }
    }

    fn finish_text(&mut self, rec: Rec, entry: &TextCtx) {
        let raw = entry.text.as_str();
        let range = self.text_range(entry);
        match rec.name.as_str() {
            "SHORT-NAME" => {
                if let Some(index) = self.immediate(&[
                    RecKind::Package,
                    RecKind::Module,
                    RecKind::Container,
                    RecKind::Param,
                    RecKind::Reference,
                ]) {
                    if let Some(parent) = self.rec_mut(index) {
                        parent.short_name = Some(raw.trim().to_string());
                        parent.short_name_range = range;
                    }
                }
            }
            "DEFINITION-REF" => {
                if let Some(index) = self.immediate(&NODE_KINDS) {
                    let dest = entry
                        .attrs
                        .as_ref()
                        .and_then(|a| a.get("DEST"))
                        .map(|v| v.trim().to_string());
                    if let Some(parent) = self.rec_mut(index) {
                        parent.definition_ref = Some(raw.trim().to_string());
                        parent.definition_ref_range = range;
                        if let Some(dest) = dest {
                            parent.definition_dest = Some(dest);
                        }
                    }
                }
            }
            "IMPLEMENTATION-CONFIG-VARIANT" => {
                if let Some(index) = self.immediate(&[RecKind::Module]) {
                    if let Some(parent) = self.rec_mut(index) {
                        parent.variant = Some(raw.trim().to_string());
                        parent.variant_range = range;
                    }
                }
            }
            "SW-SYSCOND" => {
                if let Some(index) = self.nearest(&NODE_KINDS) {
                    if let Some(parent) = self.rec_mut(index) {
                        parent.syscond = Some(decode_xml(raw).trim().to_string());
                        parent.syscond_range = range;
                    }
                }
            }
            "MATCHING-CRITERION-REF" => {
                if let Some(index) = self.nearest_kind(RecKind::PbCondition) {
                    if let Some(parent) = self.rec_mut(index) {
                        parent.criterion_raw = Some(raw.trim().to_string());
                    }
                }
            }
            "L-4" => {
                let parent = if self.has_ancestor("LABEL") {
                    self.nearest_kind(RecKind::Annotation)
                } else {
                    None
                };
                if let Some(parent) = parent {
                    if let Some(rec) = self.rec_mut(parent) {
                        if rec.label.is_none() {
                            rec.label = Some(decode_xml(raw).trim().to_string());
                        }
                    }
                }
            }
            "L-5" => {
                let parent =
                    if self.has_ancestor("ANNOTATION-TEXT") && self.has_ancestor("VERBATIM") {
                        self.nearest_kind(RecKind::Annotation)
                    } else {
                        None
                    };
                if let Some(parent) = parent {
                    if let Some(rec) = self.rec_mut(parent) {
                        if rec.text.is_none() {
                            rec.text = Some(decode_xml(raw).trim().to_string());
                        }
                    }
                }
            }
            "VALUE-REF" | "TARGET-REF" => {
                if let Some(index) = self.nearest(&[RecKind::Reference]) {
                    let dest = entry
                        .attrs
                        .as_ref()
                        .and_then(|a| a.get("DEST"))
                        .map(|v| v.trim().to_string());
                    if let Some(parent) = self.rec_mut(index) {
                        parent.target_raw = Some(raw.trim().to_string());
                        parent.target_range = range;
                        if let Some(dest) = dest {
                            parent.target_dest = Some(dest);
                        }
                    }
                }
            }
            "CONTEXT-ELEMENT-REF" => {
                if let Some(index) = self.nearest(&[RecKind::Reference]) {
                    if let Some(parent) = self.rec_mut(index) {
                        parent.context_raw.push(raw.trim().to_string());
                    }
                }
            }
            _ => {}
        }
    }

    fn finish_value(&mut self, rec: Rec, entry: &TextCtx) {
        match entry.value_role {
            Some(ValueRole::Pb) => {
                if let Some(index) = self.nearest(&[RecKind::PbCondition]) {
                    if let Some(parent) = self.rec_mut(index) {
                        parent.pb_value_raw = Some(entry.text.clone());
                    }
                }
            }
            Some(ValueRole::Param) => {
                if let Some(index) = self.nearest(&[RecKind::Param]) {
                    let range = self.text_range(entry).or(rec.range);
                    if let Some(parent) = self.rec_mut(index) {
                        parent.display_value = Some(decode_xml(&entry.text).trim().to_string());
                        parent.value_range = range;
                    }
                }
            }
            None => {}
        }
    }

    /// Raw, whitespace-trimmed span of an element's text content.
    fn text_range(&self, entry: &TextCtx) -> Option<Range> {
        if entry.text_start < 0 || entry.text_end <= entry.text_start {
            return None;
        }
        let trimmed = entry.text.trim();
        if trimmed.is_empty() {
            return None;
        }
        let leading = entry.text.len() - entry.text.trim_start().len();
        let trailing = entry.text.len() - entry.text.trim_end().len();
        let leading_utf16 = super::text::utf16_len(&entry.text[..leading]);
        let trailing_utf16 = super::text::utf16_len(&entry.text[entry.text.len() - trailing..]);
        Some(Range {
            start: (entry.text_start as usize + leading_utf16) as u32,
            end: (entry.text_end as usize - trailing_utf16) as u32,
        })
    }

    fn nearest(&self, kinds: &[RecKind]) -> Option<usize> {
        self.stack
            .iter()
            .enumerate()
            .rev()
            .find_map(|(index, entry)| {
                let kind = entry.rec.as_ref().map(|rec| rec.kind());
                kind.filter(|kind| kinds.contains(kind)).map(|_| index)
            })
    }

    fn nearest_kind(&self, kind: RecKind) -> Option<usize> {
        self.stack
            .iter()
            .enumerate()
            .rev()
            .find_map(|(index, entry)| {
                entry
                    .rec
                    .as_ref()
                    .filter(|rec| rec.kind() == kind)
                    .map(|_| index)
            })
    }

    fn rec_mut(&mut self, index: usize) -> Option<&mut Rec> {
        self.stack
            .get_mut(index)
            .and_then(|entry| entry.rec.as_mut())
    }

    fn immediate(&self, kinds: &[RecKind]) -> Option<usize> {
        let index = self.stack.len().checked_sub(1)?;
        let kind = self.stack[index].rec.as_ref().map(|rec| rec.kind())?;
        kinds.contains(&kind).then_some(index)
    }

    fn has_ancestor(&self, name: &str) -> bool {
        self.stack.iter().any(|entry| entry.name == name)
    }

    fn ancestor_short_names(&self, kinds: &[RecKind]) -> Vec<String> {
        self.stack
            .iter()
            .filter_map(|entry| {
                entry
                    .rec
                    .as_ref()
                    .filter(|rec| kinds.contains(&rec.kind()))
                    .and_then(|rec| rec.short_name.clone().filter(|name| !name.is_empty()))
            })
            .collect()
    }

    fn scan_all(&mut self) {
        while self.at < self.len {
            self.scan_text();
            if self.at >= self.len {
                return;
            }
            if self.scan_markup() {
                continue;
            }
            self.at = self.read_tag(self.at);
        }
    }

    fn scan_text(&mut self) {
        let rest = &self.text[self.at..];
        match rest.find('<') {
            Some(offset) => {
                if offset > 0 {
                    let from = self.at;
                    let to = self.at + offset;
                    let slice = self.text[from..to].to_string();
                    self.append(&slice, from, to);
                    self.at = to;
                }
            }
            None => {
                let from = self.at;
                let to = self.len;
                let slice = self.text[from..to].to_string();
                self.append(&slice, from, to);
                self.at = self.len;
            }
        }
    }

    fn starts_with(&self, marker: &str, at: usize) -> bool {
        self.text
            .get(at..)
            .map(|rest| rest.starts_with(marker))
            .unwrap_or(false)
    }

    fn skip_to(&mut self, marker: &str, from: usize, past: usize) {
        let end = self
            .text
            .get(from..)
            .and_then(|rest| rest.find(marker))
            .map(|i| from + i);
        self.at = match end {
            Some(index) => index + past,
            None => self.len,
        };
    }

    fn scan_markup(&mut self) -> bool {
        if self.starts_with("<!--", self.at) {
            self.skip_to("-->", self.at + 4, 3);
            return true;
        }
        if self.starts_with("<![CDATA[", self.at) {
            let start = self.at + 9;
            let end = self
                .text
                .get(start..)
                .and_then(|rest| rest.find("]]>"))
                .map(|i| start + i);
            let stop = end.unwrap_or(self.len);
            if stop > start {
                let slice = self.text[start..stop].to_string();
                self.append(&slice, start, stop);
            }
            self.at = match end {
                Some(index) => index + 3,
                None => self.len,
            };
            return true;
        }
        if self.starts_with("<?", self.at) {
            self.skip_to("?>", self.at + 2, 2);
            return true;
        }
        if self.starts_with("<!", self.at) {
            let end = markup_declaration_end(self.text, self.at);
            self.at = if end == usize::MAX { self.len } else { end };
            return true;
        }
        false
    }

    fn take_containers(&mut self, recs: Vec<Rec>) -> Vec<ContainerNode> {
        recs.into_iter().map(|rec| self.to_container(rec)).collect()
    }

    #[allow(clippy::wrong_self_convention)]
    fn to_container(&mut self, rec: Rec) -> ContainerNode {
        let suffixes = rec.suffixes();
        let parameters = rec.parameters.into_iter().map(to_parameter).collect();
        let references = rec.references.into_iter().map(to_reference).collect();
        let containers = rec
            .containers
            .into_iter()
            .map(|child| self.to_container(child))
            .collect();
        ContainerNode {
            kind: "container".to_string(),
            definition_ref: rec.definition_ref.clone().unwrap_or_default(),
            definition_ref_range: rec.definition_ref_range,
            short_name: rec.short_name.clone().unwrap_or_default(),
            short_name_range: rec.short_name_range,
            range: rec.range.unwrap_or_default(),
            container_path: rec.container_path.clone().unwrap_or_default(),
            parameters,
            references,
            containers,
            suffixes,
        }
    }
}

fn node_record(name: &str) -> Option<Rec> {
    let mut rec = match name {
        "ECUC-MODULE-CONFIGURATION-VALUES" => Rec::new(RecKind::Module, name),
        "ECUC-CONTAINER-VALUE" => Rec::new(RecKind::Container, name),
        "ECUC-NUMERICAL-PARAM-VALUE" => {
            let mut rec = Rec::new(RecKind::Param, name);
            rec.numeric = true;
            rec
        }
        "ECUC-TEXTUAL-PARAM-VALUE" => {
            let mut rec = Rec::new(RecKind::Param, name);
            rec.numeric = false;
            rec
        }
        "ECUC-REFERENCE-VALUE" => {
            let mut rec = Rec::new(RecKind::Reference, name);
            rec.instance = false;
            rec
        }
        "ECUC-INSTANCE-REFERENCE-VALUE" => {
            let mut rec = Rec::new(RecKind::Reference, name);
            rec.instance = true;
            rec
        }
        _ => return None,
    };
    rec.parameters = Vec::new();
    rec.references = Vec::new();
    rec.containers = Vec::new();
    Some(rec)
}

fn to_parameter(rec: Rec) -> ParameterNode {
    let definition_ref = rec.definition_ref.clone().unwrap_or_default();
    ParameterNode {
        kind: "parameter".to_string(),
        numeric: rec.numeric,
        definition_dest: rec.definition_dest.clone(),
        name: last_short_name(&definition_ref).to_string(),
        definition_ref,
        definition_ref_range: rec.definition_ref_range,
        display_value: rec.display_value.clone(),
        value_range: rec.value_range,
        range: rec.range.unwrap_or_default(),
        suffixes: rec.suffixes(),
    }
}

fn to_reference(rec: Rec) -> ReferenceNode {
    let definition_ref = rec.definition_ref.clone().unwrap_or_default();
    ReferenceNode {
        kind: "reference".to_string(),
        instance: rec.instance,
        name: last_short_name(&definition_ref).to_string(),
        definition_ref,
        definition_ref_range: rec.definition_ref_range,
        target_raw_path: rec.target_raw.clone(),
        target_dest: rec.target_dest.clone(),
        target_path: rec.target_path.clone(),
        context_paths: rec.context_paths.clone().unwrap_or_default(),
        target_range: rec.target_range,
        range: rec.range.unwrap_or_default(),
        suffixes: rec.suffixes(),
    }
}
