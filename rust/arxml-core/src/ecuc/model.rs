//! ARTEXT information model for one ECUC-Values ARXML file.
//!
//! Every node carries the source range needed for navigation and editing. Offsets
//! are UTF-16 code units (`text::Range`). The shape mirrors the TypeScript model
//! this engine replaces, field for field, so the host and the parity oracle can
//! compare them directly.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

pub use super::text::Range;

pub type SortMode = String;

/// `SW-SYSCOND` text, trimmed.
pub const SORT_ALL: &str = "all";
pub const SORT_DECLARATION: &str = "declaration";

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PostBuildVariant {
    pub criterion: String,
    pub operator: String,
    pub value: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<Range>,
}

/// Values contributed by `VARIATION-POINT` and `ANNOTATIONS`, shared by every node.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Suffixes {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub syscond: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub syscond_range: Option<Range>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_build_variants: Option<Vec<PostBuildVariant>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_build_range: Option<Range>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<Vec<Annotation>>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModuleNode {
    pub kind: String,
    pub definition_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_ref_range: Option<Range>,
    pub short_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_name_range: Option<Range>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant_range: Option<Range>,
    pub range: Range,
    pub containers: Vec<ContainerNode>,
    #[serde(flatten)]
    pub suffixes: Suffixes,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContainerNode {
    pub kind: String,
    pub definition_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_ref_range: Option<Range>,
    pub short_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_name_range: Option<Range>,
    pub range: Range,
    /// Ancestor `SHORT-NAME` chain, module last.
    pub container_path: Vec<String>,
    pub parameters: Vec<ParameterNode>,
    pub references: Vec<ReferenceNode>,
    pub containers: Vec<ContainerNode>,
    #[serde(flatten)]
    pub suffixes: Suffixes,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ParameterNode {
    pub kind: String,
    pub numeric: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_dest: Option<String>,
    pub definition_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_ref_range: Option<Range>,
    /// `DEFINITION-REF` tail.
    pub name: String,
    /// Entity-decoded text for display.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_value: Option<String>,
    /// Text content inside `<VALUE>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_range: Option<Range>,
    pub range: Range,
    #[serde(flatten)]
    pub suffixes: Suffixes,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceNode {
    pub kind: String,
    pub instance: bool,
    pub definition_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_ref_range: Option<Range>,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_raw_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_dest: Option<String>,
    /// Dotted equivalent of `structify`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_path: Option<String>,
    pub context_paths: Vec<String>,
    /// Text content inside `VALUE-REF` / `TARGET-REF`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_range: Option<Range>,
    pub range: Range,
    #[serde(flatten)]
    pub suffixes: Suffixes,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRelease {
    pub release: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackageEntry {
    pub path: Vec<String>,
    pub range: Range,
}

/// `SHORT-NAME` path -> element range, in first-seen order (later duplicates are ignored).
#[derive(Clone, Debug, Default)]
pub struct PathIndex {
    entries: Vec<(String, Range)>,
    exact: HashMap<String, Range>,
}

impl serde::Serialize for PathIndex {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeSeq;
        let mut seq = serializer.serialize_seq(Some(self.entries.len()))?;
        for (path, range) in &self.entries {
            seq.serialize_element(&(path, range))?;
        }
        seq.end()
    }
}

impl PathIndex {
    pub fn add(&mut self, path: String, range: Range) {
        if self.exact.contains_key(&path) {
            return;
        }
        self.exact.insert(path.clone(), range);
        self.entries.push((path, range));
    }

    pub fn get(&self, path: &str) -> Option<Range> {
        self.exact.get(path).copied()
    }

    pub fn entries(&self) -> &[(String, Range)] {
        &self.entries
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Moves every range at or after `pos` by `delta` UTF-16 units.
    pub fn shift(&mut self, pos: u32, delta: i32) {
        for (_, range) in &mut self.entries {
            shift_range(range, pos, delta);
        }
        for range in self.exact.values_mut() {
            shift_range(range, pos, delta);
        }
    }
}

/// Shifts one range: wholly after `pos` moves, straddling it only grows/shrinks.
pub fn shift_range(range: &mut Range, pos: u32, delta: i32) {
    if range.start >= pos {
        range.start = (range.start as i64 + delta as i64) as u32;
        range.end = (range.end as i64 + delta as i64) as u32;
    } else if range.end > pos {
        range.end = (range.end as i64 + delta as i64) as u32;
    }
}

fn shift_opt(range: &mut Option<Range>, pos: u32, delta: i32) {
    if let Some(range) = range {
        shift_range(range, pos, delta);
    }
}

fn shift_suffixes(suffixes: &mut Suffixes, pos: u32, delta: i32) {
    shift_opt(&mut suffixes.syscond_range, pos, delta);
    shift_opt(&mut suffixes.post_build_range, pos, delta);
    for annotation in suffixes.annotations.iter_mut().flatten() {
        shift_opt(&mut annotation.range, pos, delta);
    }
}

fn shift_parameter(parameter: &mut ParameterNode, pos: u32, delta: i32) {
    shift_range(&mut parameter.range, pos, delta);
    shift_opt(&mut parameter.definition_ref_range, pos, delta);
    shift_opt(&mut parameter.value_range, pos, delta);
    shift_suffixes(&mut parameter.suffixes, pos, delta);
}

fn shift_reference(reference: &mut ReferenceNode, pos: u32, delta: i32) {
    shift_range(&mut reference.range, pos, delta);
    shift_opt(&mut reference.definition_ref_range, pos, delta);
    shift_opt(&mut reference.target_range, pos, delta);
    shift_suffixes(&mut reference.suffixes, pos, delta);
}

fn shift_container(container: &mut ContainerNode, pos: u32, delta: i32) {
    shift_range(&mut container.range, pos, delta);
    shift_opt(&mut container.definition_ref_range, pos, delta);
    shift_opt(&mut container.short_name_range, pos, delta);
    shift_suffixes(&mut container.suffixes, pos, delta);
    for parameter in &mut container.parameters {
        shift_parameter(parameter, pos, delta);
    }
    for reference in &mut container.references {
        shift_reference(reference, pos, delta);
    }
    for child in &mut container.containers {
        shift_container(child, pos, delta);
    }
}

impl EcucDocumentModel {
    /// Moves every range at or after `pos`, the ranges one text change shifts.
    pub fn shift(&mut self, pos: u32, delta: i32) {
        for module in &mut self.modules {
            shift_range(&mut module.range, pos, delta);
            shift_opt(&mut module.definition_ref_range, pos, delta);
            shift_opt(&mut module.short_name_range, pos, delta);
            shift_opt(&mut module.variant_range, pos, delta);
            shift_suffixes(&mut module.suffixes, pos, delta);
            for container in &mut module.containers {
                shift_container(container, pos, delta);
            }
        }
        for package in &mut self.packages {
            shift_range(&mut package.range, pos, delta);
        }
        self.path_index.shift(pos, delta);
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EcucDocumentModel {
    pub schema: Option<SchemaRelease>,
    pub packages: Vec<PackageEntry>,
    pub modules: Vec<ModuleNode>,
    pub path_index: PathIndex,
}

/// The `DEFINITION-REF` tail.
pub fn last_short_name(path: &str) -> &str {
    match path.rfind('/') {
        Some(index) => &path[index + 1..],
        None => path,
    }
}

/// `/A/B/C` -> `A.B.C`: the legacy `structify` (empty leading segment skipped).
pub fn structify(path: &str) -> String {
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() <= 1 {
        return path.trim().to_string();
    }
    parts[1..].join(".")
}

/// Same-file reference resolution: exact key, then the longest unique suffix.
pub fn resolve_path(index: &PathIndex, raw_path: &str) -> Option<Range> {
    let segments: Vec<&str> = raw_path.split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return None;
    }
    for start in 0..segments.len() {
        let candidate = format!("/{}", segments[start..].join("/"));
        if let Some(range) = index.get(&candidate) {
            return Some(range);
        }
        let mut matches = index
            .entries()
            .iter()
            .filter(|(key, _)| key.ends_with(&candidate))
            .map(|(_, range)| *range);
        let first = matches.next();
        if first.is_none() {
            continue;
        }
        if matches.next().is_some() {
            return None; // ambiguous: never guess
        }
        return first;
    }
    None
}
