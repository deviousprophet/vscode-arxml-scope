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
