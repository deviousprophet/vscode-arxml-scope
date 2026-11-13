//! Path-based node ids.
//!
//! An id is derived from the node's own path — the container short-name chain, the
//! `DEFINITION-REF`, its tail — and never from an array index, so it survives a
//! re-scan that reorders nodes. Siblings sharing a tail are told apart by a
//! declaration-order ordinal, which is why the index is built from the raw model
//! rather than from the display-ordered view.
//!
//! The id is looked up by a node's range: ranges are unique per element, so the
//! row builder can ask "what is this node called" without carrying references.

use std::collections::HashMap;

use super::model::{ContainerNode, EcucDocumentModel, Range};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NodeKind {
    Module,
    Container,
    Parameter,
    Reference,
}

impl NodeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            NodeKind::Module => "module",
            NodeKind::Container => "container",
            NodeKind::Parameter => "parameter",
            NodeKind::Reference => "reference",
        }
    }
}

#[derive(Clone, Debug)]
pub struct NodeEntry {
    pub id: String,
    pub kind: NodeKind,
    pub label: String,
    pub path: Option<String>,
    pub range: Range,
}

#[derive(Default)]
pub struct NodeIndex {
    by_id: HashMap<String, NodeEntry>,
    by_range: HashMap<(u32, u32), String>,
    sorted: Vec<String>,
}

impl NodeIndex {
    pub fn get(&self, id: &str) -> Option<&NodeEntry> {
        self.by_id.get(id)
    }

    /// The id this index assigned to the node occupying `range`.
    pub fn id_of(&self, range: Range) -> Option<&str> {
        self.by_range
            .get(&(range.start, range.end))
            .map(String::as_str)
    }

    pub fn entry_at(&self, range: Range) -> Option<&NodeEntry> {
        self.id_of(range).and_then(|id| self.get(id))
    }

    /// Entries ordered by range start, widest range first: the innermost-node lookup.
    pub fn sorted(&self) -> impl Iterator<Item = &NodeEntry> {
        self.sorted.iter().filter_map(|id| self.by_id.get(id))
    }

    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &NodeEntry> {
        self.by_id.values()
    }

    fn add(&mut self, entry: NodeEntry) {
        self.by_range
            .insert((entry.range.start, entry.range.end), entry.id.clone());
        self.by_id.insert(entry.id.clone(), entry);
    }

    fn finish(&mut self) {
        self.sorted = self.by_id.keys().cloned().collect();
        self.sorted.sort_by(|left, right| {
            let a = &self.by_id[left];
            let b = &self.by_id[right];
            a.range
                .start
                .cmp(&b.range.start)
                .then(b.range.end.cmp(&a.range.end))
        });
    }
}

/// Builds the id index for every node of a model.
pub fn build_node_index(model: &EcucDocumentModel) -> NodeIndex {
    let mut index = NodeIndex::default();
    let mut ordinals: HashMap<String, u32> = HashMap::new();
    let mut path_by_range: HashMap<(u32, u32), String> = HashMap::new();
    for (path, range) in model.path_index.entries() {
        path_by_range
            .entry((range.start, range.end))
            .or_insert_with(|| path.clone());
    }

    let mut add =
        |index: &mut NodeIndex, id: String, kind: NodeKind, label: String, range: Range| {
            let path = path_by_range.get(&(range.start, range.end)).cloned();
            index.add(NodeEntry {
                id,
                kind,
                label,
                path,
                range,
            });
        };

    for module in &model.modules {
        let name = format!("{}|{}", module.definition_ref, module.short_name);
        let ordinal = next_ordinal(&mut ordinals, "", "module", &name);
        add(
            &mut index,
            format!("module:{name}#{ordinal}"),
            NodeKind::Module,
            module.short_name.clone(),
            module.range,
        );
        for container in &module.containers {
            visit_container(&mut index, &mut ordinals, &mut add, container);
        }
    }

    index.finish();
    index
}

fn next_ordinal(ordinals: &mut HashMap<String, u32>, owner: &str, kind: &str, name: &str) -> u32 {
    let key = format!("{owner}|{kind}|{name}");
    let next = ordinals.get(&key).copied().unwrap_or(0);
    ordinals.insert(key, next + 1);
    next
}

fn visit_container(
    index: &mut NodeIndex,
    ordinals: &mut HashMap<String, u32>,
    add: &mut impl FnMut(&mut NodeIndex, String, NodeKind, String, Range),
    container: &ContainerNode,
) {
    let owner = container.container_path.join("/");
    let ordinal = next_ordinal(ordinals, &owner, "container", &container.short_name);
    let id = format!("container:{owner}/{}#{ordinal}", container.short_name);
    add(
        index,
        id.clone(),
        NodeKind::Container,
        container.short_name.clone(),
        container.range,
    );
    for parameter in &container.parameters {
        let ordinal = next_ordinal(ordinals, &id, "param", &parameter.name);
        add(
            index,
            format!("{id}/param:{}#{ordinal}", parameter.name),
            NodeKind::Parameter,
            parameter.name.clone(),
            parameter.range,
        );
    }
    for reference in &container.references {
        let ordinal = next_ordinal(ordinals, &id, "ref", &reference.name);
        add(
            index,
            format!("{id}/ref:{}#{ordinal}", reference.name),
            NodeKind::Reference,
            reference.name.clone(),
            reference.range,
        );
    }
    for child in &container.containers {
        visit_container(index, ordinals, add, child);
    }
}
