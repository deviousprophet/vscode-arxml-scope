//! The merge index: one entry per ECUC node, for a three-way merge.
//!
//! Each entry carries the node's stable id, its parent and declaration order, the
//! exact element range in the source text, and an **own digest**: a hash over the
//! fields that belong to the node itself, never its children. The digest is what
//! distinguishes "this node changed" from "a child changed", which is what lets a
//! container whose children were edited on different sides merge both.
//!
//! The digest is computed in the engine so the field list lives next to the model
//! that defines it; the host only compares hex strings.

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::model::{
    ContainerNode, EcucDocumentModel, ModuleNode, ParameterNode, ReferenceNode, Suffixes,
};
use super::node_id::NodeIndex;
use super::text::Range;

/// One node, as the merge planner sees it.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeIndexNode {
    pub id: String,
    pub kind: String,
    /// The AR path when the model indexed one, else the node's own label.
    pub path: String,
    pub parent_id: Option<String>,
    /// Declaration order among siblings, starting at zero.
    pub order: u32,
    /// The whole element, tags included.
    pub range: Range,
    pub own_digest: String,
}

/// Builds the merge index in declaration order (modules, then each subtree).
pub fn merge_index(model: &EcucDocumentModel, index: &NodeIndex) -> Vec<MergeIndexNode> {
    let mut nodes = Vec::new();
    for module in &model.modules {
        let Some(module_id) = index.id_of(module.range).map(str::to_string) else {
            continue;
        };
        nodes.push(MergeIndexNode {
            id: module_id.clone(),
            kind: "module".to_string(),
            path: path_of(index, &module_id, &module.short_name),
            parent_id: None,
            order: nodes.len() as u32,
            range: module.range,
            own_digest: module_digest(module),
        });
        let mut child_order = 0u32;
        for container in &module.containers {
            push_container(&mut nodes, index, container, &module_id, &mut child_order);
        }
    }
    nodes
}

fn push_container(
    nodes: &mut Vec<MergeIndexNode>,
    index: &NodeIndex,
    container: &ContainerNode,
    parent_id: &str,
    order: &mut u32,
) {
    let Some(id) = index.id_of(container.range).map(str::to_string) else {
        return;
    };
    nodes.push(MergeIndexNode {
        id: id.clone(),
        kind: "container".to_string(),
        path: path_of(index, &id, &container.short_name),
        parent_id: Some(parent_id.to_string()),
        order: *order,
        range: container.range,
        own_digest: container_digest(container),
    });
    *order += 1;

    let mut member_order = 0u32;
    for parameter in &container.parameters {
        let Some(parameter_id) = index.id_of(parameter.range).map(str::to_string) else {
            continue;
        };
        nodes.push(MergeIndexNode {
            id: parameter_id.clone(),
            kind: "parameter".to_string(),
            path: path_of(index, &parameter_id, &parameter.name),
            parent_id: Some(id.clone()),
            order: member_order,
            range: parameter.range,
            own_digest: parameter_digest(parameter),
        });
        member_order += 1;
    }
    for reference in &container.references {
        let Some(reference_id) = index.id_of(reference.range).map(str::to_string) else {
            continue;
        };
        nodes.push(MergeIndexNode {
            id: reference_id.clone(),
            kind: "reference".to_string(),
            path: path_of(index, &reference_id, &reference.name),
            parent_id: Some(id.clone()),
            order: member_order,
            range: reference.range,
            own_digest: reference_digest(reference),
        });
        member_order += 1;
    }
    for child in &container.containers {
        push_container(nodes, index, child, &id, &mut member_order);
    }
}

fn path_of(index: &NodeIndex, id: &str, fallback: &str) -> String {
    index
        .get(id)
        .and_then(|entry| entry.path.clone())
        .unwrap_or_else(|| fallback.to_string())
}

/// A field-ordered SHA-256 builder; the separator cannot occur in an ECUC field.
struct OwnDigest {
    hasher: Sha256,
}

impl OwnDigest {
    fn new(kind: &str) -> Self {
        let mut digest = Self {
            hasher: Sha256::new(),
        };
        digest.field(kind);
        digest
    }

    fn field(&mut self, value: &str) {
        self.hasher.update(value.as_bytes());
        self.hasher.update([0x1f]);
    }

    fn number(&mut self, value: u32) {
        self.field(&value.to_string());
    }

    fn finish(self) -> String {
        format!("{:x}", self.hasher.finalize())
    }
}

fn push_suffixes(digest: &mut OwnDigest, suffixes: &Suffixes) {
    digest.field(suffixes.syscond.as_deref().unwrap_or(""));
    digest.number(
        suffixes
            .post_build_variants
            .as_ref()
            .map(Vec::len)
            .unwrap_or(0) as u32,
    );
    for variant in suffixes.post_build_variants.iter().flatten() {
        digest.field(&variant.criterion);
        digest.field(&variant.value);
    }
    digest.number(suffixes.annotations.as_ref().map(Vec::len).unwrap_or(0) as u32);
    for annotation in suffixes.annotations.iter().flatten() {
        digest.field(annotation.label.as_deref().unwrap_or(""));
        digest.field(annotation.text.as_deref().unwrap_or(""));
    }
}

fn module_digest(module: &ModuleNode) -> String {
    let mut digest = OwnDigest::new("module");
    digest.field(&module.short_name);
    digest.field(&module.definition_ref);
    digest.field(module.variant.as_deref().unwrap_or(""));
    push_suffixes(&mut digest, &module.suffixes);
    digest.finish()
}

fn container_digest(container: &ContainerNode) -> String {
    let mut digest = OwnDigest::new("container");
    digest.field(&container.short_name);
    digest.field(&container.definition_ref);
    push_suffixes(&mut digest, &container.suffixes);
    digest.finish()
}

fn parameter_digest(parameter: &ParameterNode) -> String {
    let mut digest = OwnDigest::new("parameter");
    digest.field(&parameter.definition_ref);
    digest.field(parameter.definition_dest.as_deref().unwrap_or(""));
    digest.field(parameter.display_value.as_deref().unwrap_or(""));
    digest.field(if parameter.numeric {
        "numeric"
    } else {
        "textual"
    });
    push_suffixes(&mut digest, &parameter.suffixes);
    digest.finish()
}

fn reference_digest(reference: &ReferenceNode) -> String {
    let mut digest = OwnDigest::new("reference");
    digest.field(&reference.definition_ref);
    digest.field(reference.target_raw_path.as_deref().unwrap_or(""));
    digest.field(reference.target_dest.as_deref().unwrap_or(""));
    digest.field(if reference.instance {
        "instance"
    } else {
        "plain"
    });
    digest.number(reference.context_paths.len() as u32);
    for context in &reference.context_paths {
        digest.field(context);
    }
    push_suffixes(&mut digest, &reference.suffixes);
    digest.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ecuc::{build_node_index, scan_ecuc_values};

    fn doc(value: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0">
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Pkg</SHORT-NAME>
      <ELEMENTS>
        <ECUC-MODULE-CONFIGURATION-VALUES>
          <SHORT-NAME>Mod</SHORT-NAME>
          <DEFINITION-REF DEST="ECUC-MODULE-DEF">/Pkg/Mod</DEFINITION-REF>
          <CONTAINERS>
            <ECUC-CONTAINER-VALUE>
              <SHORT-NAME>Cont</SHORT-NAME>
              <DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Pkg/Mod/Cont</DEFINITION-REF>
              <PARAMETER-VALUES>
                <ECUC-NUMERICAL-PARAM-VALUE>
                  <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/Mod/Cont/P</DEFINITION-REF>
                  <VALUE>{value}</VALUE>
                </ECUC-NUMERICAL-PARAM-VALUE>
              </PARAMETER-VALUES>
            </ECUC-CONTAINER-VALUE>
          </CONTAINERS>
        </ECUC-MODULE-CONFIGURATION-VALUES>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>
"#
        )
    }

    fn index_of(text: &str) -> Vec<MergeIndexNode> {
        let model = scan_ecuc_values(text.to_string());
        merge_index(&model, &build_node_index(&model))
    }

    #[test]
    fn the_index_covers_every_node_with_declaration_order() {
        let nodes = index_of(&doc("1"));
        assert_eq!(nodes.len(), 3, "module, container and parameter");
        assert_eq!(nodes[0].kind, "module");
        assert_eq!(nodes[1].parent_id.as_deref(), Some(nodes[0].id.as_str()));
        assert_eq!(nodes[2].parent_id.as_deref(), Some(nodes[1].id.as_str()));
        assert_eq!(nodes[1].order, 0);
        assert_eq!(nodes[2].order, 0);
        assert_eq!(nodes[0].path, "/Pkg/Mod");
    }

    #[test]
    fn the_element_range_starts_at_the_open_tag() {
        let text = doc("1");
        let nodes = index_of(&text);
        let value = &text[nodes[2].range.start as usize..nodes[2].range.end as usize];
        assert!(value.starts_with("<ECUC-NUMERICAL-PARAM-VALUE>"), "{value}");
        assert!(value.ends_with("</ECUC-NUMERICAL-PARAM-VALUE>"), "{value}");
    }

    #[test]
    fn a_child_change_does_not_change_the_parent_digest() {
        let before = index_of(&doc("1"));
        let after = index_of(&doc("2"));
        assert_eq!(before[0].own_digest, after[0].own_digest, "module digest");
        assert_eq!(
            before[1].own_digest, after[1].own_digest,
            "container digest"
        );
        assert_ne!(
            before[2].own_digest, after[2].own_digest,
            "parameter digest"
        );
    }

    #[test]
    fn digests_are_stable_across_a_rescan() {
        let first = index_of(&doc("7"));
        let second = index_of(&doc("7"));
        for (left, right) in first.iter().zip(&second) {
            assert_eq!(left.id, right.id);
            assert_eq!(left.own_digest, right.own_digest);
        }
    }

    #[test]
    fn a_renamed_container_changes_only_its_own_digest() {
        let renamed = doc("1").replace(
            "<SHORT-NAME>Cont</SHORT-NAME>",
            "<SHORT-NAME>Other</SHORT-NAME>",
        );
        let before = index_of(&doc("1"));
        let after = index_of(&renamed);
        assert_eq!(before[0].own_digest, after[0].own_digest);
        assert_ne!(before[1].own_digest, after[1].own_digest);
        assert_eq!(
            before[2].own_digest, after[2].own_digest,
            "parameter is untouched"
        );
    }
}
