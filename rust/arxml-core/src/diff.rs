//! The semantic-diff model: a strict, parity-exact port of the TypeScript builder.
//!
//! Rows are the engine's own `Row` values; the comparison needs no model, only the
//! rows and their element ranges. The result is the document the diff panel embeds.
//! Semantic matching is a later milestone; this module implements the strict path.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::ecuc::rows::{MetaPart, Row};
use crate::ecuc::text::Range;

const ADDED_KEY_PREFIX: &str = "right:";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffCell {
    pub kind: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_name: Option<String>,
    pub definition_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_dest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shown_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comments: Option<Vec<String>>,
    pub meta: Vec<MetaPart>,
    pub range: Range,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffChange {
    pub field: String,
    pub left: String,
    pub right: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rename_implied: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffStatus {
    Unchanged,
    Changed,
    Added,
    Removed,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRow {
    pub key: String,
    pub parent_key: Option<String>,
    pub level: u32,
    pub posinset: u32,
    pub setsize: u32,
    pub kind: String,
    pub has_children: bool,
    pub subtree_size: u32,
    pub status: DiffStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left: Option<DiffCell>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right: Option<DiffCell>,
    pub changes: Vec<DiffChange>,
    pub haystack: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSummary {
    pub changed: u32,
    pub added: u32,
    pub removed: u32,
    pub unchanged: u32,
    pub renamed: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHeader {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    pub packages: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLabel {
    pub name: String,
    pub path: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffDocument {
    pub left: FileLabel,
    pub right: FileLabel,
    pub left_header: DiffHeader,
    pub right_header: DiffHeader,
    pub labels: [String; 2],
    pub rows: Vec<DiffRow>,
    pub summary: DiffSummary,
    pub semantic_skipped: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub semantic_limit_reason: Option<String>,
}

/// The id → range lookup the caller supplies (the engine's node index).
pub type RangeLookup<'a> = &'a dyn Fn(&str) -> Option<Range>;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffOptions {
    pub semantic_matching: bool,
}

struct TreeNode {
    row: usize,
    children: Vec<usize>,
}

struct Tree {
    nodes: Vec<TreeNode>,
    roots: Vec<usize>,
}

fn tree_of(rows: &[Row]) -> Tree {
    let mut tree = Tree {
        nodes: Vec::new(),
        roots: Vec::new(),
    };
    let roots = build_level(rows, 0, rows.len(), &mut tree);
    tree.roots = roots;
    tree
}

fn build_level(rows: &[Row], start: usize, end: usize, tree: &mut Tree) -> Vec<usize> {
    let mut out = Vec::new();
    let mut index = start;
    while index < end {
        let row = &rows[index];
        let stop = (index + 1 + row.subtree_size as usize).min(end);
        let node = tree.nodes.len();
        tree.nodes.push(TreeNode {
            row: index,
            children: Vec::new(),
        });
        let children = build_level(rows, index + 1, stop, tree);
        tree.nodes[node].children = children;
        out.push(node);
        index = if stop > index { stop } else { index + 1 };
    }
    out
}

/// The ordinal-free id: every `#<n>` before a `/` or the end is removed.
pub fn base_id(id: &str) -> String {
    let mut out = String::with_capacity(id.len());
    let bytes = id.as_bytes();
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'#' {
            let mut end = at + 1;
            while end < bytes.len() && bytes[end].is_ascii_digit() {
                end += 1;
            }
            let boundary = end == bytes.len() || bytes[end] == b'/';
            if end > at + 1 && boundary {
                at = end;
                continue;
            }
        }
        out.push(bytes[at] as char);
        at += 1;
    }
    out
}

fn relative_id(id: &str) -> &str {
    match id.rfind('/') {
        Some(index) => &id[index + 1..],
        None => id,
    }
}

fn cell_of(row: &Row, range: Option<Range>) -> DiffCell {
    DiffCell {
        kind: row.kind.clone(),
        label: row.label.clone(),
        short_name: row.short_name.clone(),
        definition_ref: row.definition_ref.clone(),
        definition_dest: row.definition_dest.clone(),
        shown_value: row.shown_value.clone(),
        value_kind: row.value_kind.clone(),
        value: row.value.clone(),
        target: row.target.clone(),
        context_paths: row.context_paths.clone(),
        comments: row.comments.clone(),
        meta: row.meta.clone(),
        range: range.unwrap_or_default(),
    }
}

fn meta_text(cell: &DiffCell, class: &str) -> String {
    cell.meta
        .iter()
        .filter(|part| part.cls == class)
        .map(|part| part.text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

fn context_text(cell: &DiffCell) -> String {
    if let Some(paths) = &cell.context_paths {
        if !paths.is_empty() {
            return paths.join(", ");
        }
    }
    cell.meta
        .iter()
        .find(|part| part.cls == "context")
        .map(|part| {
            part.text
                .strip_prefix("context ")
                .unwrap_or(&part.text)
                .to_string()
        })
        .unwrap_or_default()
}

fn content_identity(row: &Row) -> String {
    let cell = cell_of(row, None);
    [
        cell.kind.clone(),
        cell.definition_ref.clone(),
        cell.definition_dest.clone().unwrap_or_default(),
        cell.value.clone().unwrap_or_default(),
        cell.target.clone().unwrap_or_default(),
        context_text(&cell),
        meta_text(&cell, "variant"),
        meta_text(&cell, "condition"),
    ]
    .join("\u{0}")
}

fn subtree_identity(tree: &Tree, rows: &[Row], node: usize) -> String {
    let content = content_identity(&rows[tree.nodes[node].row]);
    let children = &tree.nodes[node].children;
    if children.is_empty() {
        return content;
    }
    let joined = children
        .iter()
        .map(|child| subtree_identity(tree, rows, *child))
        .collect::<Vec<_>>()
        .join("\u{2}");
    format!("{content}\u{1}{joined}")
}

fn sort_identity(row: &Row) -> String {
    match row.kind.as_str() {
        "parameter" => format!("value:{}", row.value.clone().unwrap_or_default()),
        "reference" => format!(
            "target:{}|context:{}",
            row.target.clone().unwrap_or_default(),
            row.context_paths.clone().unwrap_or_default().join(",")
        ),
        _ => format!(
            "definition:{}|variant:{}",
            row.definition_ref,
            cell_of(row, None)
                .meta
                .iter()
                .filter(|part| part.cls == "variant")
                .map(|part| part.text.as_str())
                .collect::<Vec<_>>()
                .join(",")
        ),
    }
}

/// An insertion-ordered map: the TypeScript diff relies on map iteration order.
#[derive(Default)]
struct OrderedGroups {
    keys: Vec<String>,
    index: HashMap<String, usize>,
    values: Vec<Vec<usize>>,
}

impl OrderedGroups {
    fn push(&mut self, key: String, value: usize) {
        if let Some(at) = self.index.get(&key).copied() {
            self.values[at].push(value);
            return;
        }
        self.index.insert(key.clone(), self.keys.len());
        self.keys.push(key);
        self.values.push(vec![value]);
    }

    fn get(&self, key: &str) -> Option<&Vec<usize>> {
        self.index.get(key).map(|at| &self.values[*at])
    }

    fn iter(&self) -> impl Iterator<Item = (&String, &Vec<usize>)> {
        self.keys.iter().zip(self.values.iter())
    }
}

fn group_by_base(tree: &Tree, rows: &[Row], nodes: &[usize], relative: bool) -> OrderedGroups {
    let mut groups = OrderedGroups::default();
    for node in nodes {
        let id = &rows[tree.nodes[*node].row].id;
        let scoped = if relative {
            relative_id(id)
        } else {
            id.as_str()
        };
        groups.push(base_id(scoped), *node);
    }
    groups
}

struct Pairing {
    match_of_right: HashMap<usize, usize>,
    matched_left: HashSet<usize>,
}

impl Pairing {
    fn try_pair(&mut self, right: usize, left: usize) -> bool {
        if self.match_of_right.contains_key(&right) || self.matched_left.contains(&left) {
            return false;
        }
        self.match_of_right.insert(right, left);
        self.matched_left.insert(left);
        true
    }
}

fn keys_for(
    tree: &Tree,
    rows: &[Row],
    nodes: &[usize],
    key: &dyn Fn(&Tree, &[Row], usize) -> String,
) -> HashMap<usize, String> {
    nodes
        .iter()
        .map(|node| (*node, key(tree, rows, *node)))
        .collect()
}

fn pair_by_key(
    lefts: &[usize],
    rights: &[usize],
    left_keys: &HashMap<usize, String>,
    right_keys: &HashMap<usize, String>,
    pairing: &mut Pairing,
) {
    let mut buckets = OrderedGroups::default();
    for right in rights {
        if pairing.match_of_right.contains_key(right) {
            continue;
        }
        if let Some(key) = right_keys.get(right) {
            buckets.push(key.clone(), *right);
        }
    }
    for left in lefts {
        if pairing.matched_left.contains(left) {
            continue;
        }
        let Some(key) = left_keys.get(left) else {
            continue;
        };
        let Some(bucket) = buckets.get(key) else {
            continue;
        };
        for right in bucket {
            if pairing.try_pair(*right, *left) {
                break;
            }
        }
    }
}

fn pair_identity_groups(
    lefts: &[usize],
    rights: &[usize],
    left_tree: &Tree,
    left_rows: &[Row],
    right_tree: &Tree,
    right_rows: &[Row],
    pairing: &mut Pairing,
) {
    let left_by_base = group_by_base(left_tree, left_rows, lefts, false);
    let right_by_base = group_by_base(right_tree, right_rows, rights, false);
    for (base, left_group) in left_by_base.iter() {
        let Some(right_group) = right_by_base.get(base) else {
            continue;
        };
        if left_group.len() == 1 && right_group.len() == 1 {
            continue;
        }
        let left_subtree = keys_for(left_tree, left_rows, left_group, &subtree_identity);
        let right_subtree = keys_for(right_tree, right_rows, right_group, &subtree_identity);
        pair_by_key(
            left_group,
            right_group,
            &left_subtree,
            &right_subtree,
            pairing,
        );
        let left_sort = keys_for(left_tree, left_rows, left_group, &|tree, rows, node| {
            sort_identity(&rows[tree.nodes[node].row])
        });
        let right_sort = keys_for(right_tree, right_rows, right_group, &|tree, rows, node| {
            sort_identity(&rows[tree.nodes[node].row])
        });
        pair_by_key(left_group, right_group, &left_sort, &right_sort, pairing);
    }
}

fn pair_by_identity(
    left_tree: &Tree,
    left_rows: &[Row],
    right_tree: &Tree,
    right_rows: &[Row],
    lefts: &[usize],
    rights: &[usize],
    pairing: &mut Pairing,
) {
    let mut right_by_id: HashMap<String, usize> = HashMap::new();
    for right in rights {
        right_by_id.insert(right_rows[right_tree.nodes[*right].row].id.clone(), *right);
    }
    for left in lefts {
        if pairing.matched_left.contains(left) {
            continue;
        }
        let id = &left_rows[left_tree.nodes[*left].row].id;
        if let Some(right) = right_by_id.get(id) {
            pairing.try_pair(*right, *left);
        }
    }
}

fn pair_by_base_fallback(
    left_tree: &Tree,
    left_rows: &[Row],
    right_tree: &Tree,
    right_rows: &[Row],
    lefts: &[usize],
    rights: &[usize],
    pairing: &mut Pairing,
) {
    let left_rest = group_by_base(left_tree, left_rows, lefts, false);
    let right_rest = group_by_base(right_tree, right_rows, rights, false);
    let mut candidates = Vec::new();
    for (base, left_group) in left_rest.iter() {
        if let Some(right_group) = right_rest.get(base) {
            if left_group.len() == 1 && right_group.len() == 1 {
                candidates.push((right_group[0], left_group[0]));
            }
        }
    }
    for (right, left) in candidates {
        pairing.try_pair(right, left);
    }
}

/// Pairs one level's children: identity groups, exact id, ordinal-free fallback.
fn pair_level(
    left_tree: &Tree,
    left_rows: &[Row],
    lefts: &[usize],
    right_tree: &Tree,
    right_rows: &[Row],
    rights: &[usize],
) -> Pairing {
    let mut pairing = Pairing {
        match_of_right: HashMap::new(),
        matched_left: HashSet::new(),
    };
    pair_identity_groups(
        lefts,
        rights,
        left_tree,
        left_rows,
        right_tree,
        right_rows,
        &mut pairing,
    );
    pair_by_identity(
        left_tree,
        left_rows,
        right_tree,
        right_rows,
        lefts,
        rights,
        &mut pairing,
    );
    pair_by_base_fallback(
        left_tree,
        left_rows,
        right_tree,
        right_rows,
        lefts,
        rights,
        &mut pairing,
    );
    pairing
}

struct MergedNode {
    key: String,
    kind: String,
    status: DiffStatus,
    left: Option<DiffCell>,
    right: Option<DiffCell>,
    changes: Vec<DiffChange>,
    children: Vec<MergedNode>,
}

fn change_of(field: &str, left: &str, right: &str) -> Option<DiffChange> {
    if left == right {
        return None;
    }
    Some(DiffChange {
        field: field.to_string(),
        left: left.to_string(),
        right: right.to_string(),
        rename_implied: None,
    })
}

fn diff_changes(left: &DiffCell, right: &DiffCell) -> Vec<DiffChange> {
    let mut out = Vec::new();
    if let Some(change) = change_of(
        "value",
        left.value.as_deref().unwrap_or(""),
        right.value.as_deref().unwrap_or(""),
    ) {
        out.push(change);
    } else if let Some(change) = change_of(
        "shown value",
        left.shown_value.as_deref().unwrap_or(""),
        right.shown_value.as_deref().unwrap_or(""),
    ) {
        out.push(change);
    }
    let fields: [(String, String, String); 7] = [
        (
            "target".into(),
            left.target.clone().unwrap_or_default(),
            right.target.clone().unwrap_or_default(),
        ),
        (
            "short name".into(),
            left.short_name.clone().unwrap_or_default(),
            right.short_name.clone().unwrap_or_default(),
        ),
        (
            "definition ref".into(),
            left.definition_ref.clone(),
            right.definition_ref.clone(),
        ),
        (
            "definition dest".into(),
            left.definition_dest.clone().unwrap_or_default(),
            right.definition_dest.clone().unwrap_or_default(),
        ),
        (
            "variant".into(),
            meta_text(left, "variant"),
            meta_text(right, "variant"),
        ),
        (
            "condition".into(),
            meta_text(left, "condition"),
            meta_text(right, "condition"),
        ),
        ("context".into(), context_text(left), context_text(right)),
    ];
    for (field, left_text, right_text) in fields {
        if let Some(change) = change_of(&field, &left_text, &right_text) {
            out.push(change);
        }
    }
    out
}

#[allow(clippy::too_many_arguments)]
fn paired_node(
    left_tree: &Tree,
    left_rows: &[Row],
    left: usize,
    right_tree: &Tree,
    right_rows: &[Row],
    right: usize,
    left_range: RangeLookup,
    right_range: RangeLookup,
) -> MergedNode {
    let left_row = &left_rows[left_tree.nodes[left].row];
    let right_row = &right_rows[right_tree.nodes[right].row];
    let left_cell = cell_of(left_row, left_range(&left_row.id));
    let right_cell = cell_of(right_row, right_range(&right_row.id));
    let changes = diff_changes(&left_cell, &right_cell);
    let children = merge_children(
        left_tree,
        left_rows,
        &left_tree.nodes[left].children,
        right_tree,
        right_rows,
        &right_tree.nodes[right].children,
        left_range,
        right_range,
    );
    MergedNode {
        key: left_row.id.clone(),
        kind: left_cell.kind.clone(),
        status: if changes.is_empty() {
            DiffStatus::Unchanged
        } else {
            DiffStatus::Changed
        },
        left: Some(left_cell),
        right: Some(right_cell),
        changes,
        children,
    }
}

fn side_node(
    tree: &Tree,
    rows: &[Row],
    node: usize,
    status: DiffStatus,
    range: RangeLookup,
) -> MergedNode {
    let row = &rows[tree.nodes[node].row];
    let cell = cell_of(row, range(&row.id));
    let added = status == DiffStatus::Added;
    let key = if added {
        format!("{ADDED_KEY_PREFIX}{}", row.id)
    } else {
        row.id.clone()
    };
    MergedNode {
        key,
        kind: cell.kind.clone(),
        status,
        left: if added { None } else { Some(cell.clone()) },
        right: if added { Some(cell) } else { None },
        changes: Vec::new(),
        children: tree.nodes[node]
            .children
            .iter()
            .map(|child| side_node(tree, rows, *child, status, range))
            .collect(),
    }
}

fn right_only_by_previous(
    left_tree: &Tree,
    left_rows: &[Row],
    rights: &[usize],
    pairing: &Pairing,
) -> OrderedGroups {
    let mut groups = OrderedGroups::default();
    let mut previous: Option<String> = None;
    for right in rights {
        if let Some(left) = pairing.match_of_right.get(right) {
            previous = Some(left_rows[left_tree.nodes[*left].row].id.clone());
            continue;
        }
        groups.push(previous.clone().unwrap_or_default(), *right);
    }
    groups
}

#[allow(clippy::too_many_arguments)]
fn merge_children(
    left_tree: &Tree,
    left_rows: &[Row],
    lefts: &[usize],
    right_tree: &Tree,
    right_rows: &[Row],
    rights: &[usize],
    left_range: RangeLookup,
    right_range: RangeLookup,
) -> Vec<MergedNode> {
    let pairing = pair_level(left_tree, left_rows, lefts, right_tree, right_rows, rights);
    let mut match_of_left: HashMap<usize, usize> = HashMap::new();
    for (right, left) in &pairing.match_of_right {
        match_of_left.insert(*left, *right);
    }
    let right_only = right_only_by_previous(left_tree, left_rows, rights, &pairing);
    let mut out = Vec::new();
    push_side(
        &mut out,
        right_tree,
        right_rows,
        right_only.get(""),
        DiffStatus::Added,
        right_range,
    );
    for left in lefts {
        match match_of_left.get(left) {
            Some(right) => out.push(paired_node(
                left_tree,
                left_rows,
                *left,
                right_tree,
                right_rows,
                *right,
                left_range,
                right_range,
            )),
            None => out.push(side_node(
                left_tree,
                left_rows,
                *left,
                DiffStatus::Removed,
                left_range,
            )),
        }
        let left_id = &left_rows[left_tree.nodes[*left].row].id;
        push_side(
            &mut out,
            right_tree,
            right_rows,
            right_only.get(left_id),
            DiffStatus::Added,
            right_range,
        );
    }
    out
}

fn push_side(
    out: &mut Vec<MergedNode>,
    tree: &Tree,
    rows: &[Row],
    nodes: Option<&Vec<usize>>,
    status: DiffStatus,
    range: RangeLookup,
) {
    if let Some(nodes) = nodes {
        for node in nodes {
            out.push(side_node(tree, rows, *node, status, range));
        }
    }
}

fn haystack_of(cell: &DiffCell) -> String {
    let meta = cell
        .meta
        .iter()
        .map(|part| part.text.clone())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>();
    let mut parts = vec![
        cell.label.clone(),
        cell.short_name.clone().unwrap_or_default(),
        cell.shown_value.clone().unwrap_or_default(),
    ];
    parts.extend(meta);
    parts
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn flatten(
    node: &MergedNode,
    parent_key: Option<&str>,
    level: u32,
    position: u32,
    setsize: u32,
    out: &mut Vec<DiffRow>,
) {
    let at = out.len();
    let mut row = DiffRow {
        key: node.key.clone(),
        parent_key: parent_key.map(str::to_string),
        level,
        posinset: position,
        setsize,
        kind: node.kind.clone(),
        has_children: !node.children.is_empty(),
        subtree_size: 0,
        status: node.status,
        left: node.left.clone(),
        right: node.right.clone(),
        changes: node.changes.clone(),
        haystack: String::new(),
    };
    row.haystack = [
        haystack_of_opt(node.left.as_ref()),
        haystack_of_opt(node.right.as_ref()),
    ]
    .into_iter()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(" ")
    .to_lowercase();
    out.push(row);
    let setsize = node.children.len() as u32;
    for (index, child) in node.children.iter().enumerate() {
        flatten(
            child,
            Some(&node.key),
            level + 1,
            index as u32 + 1,
            setsize,
            out,
        );
    }
    out[at].subtree_size = (out.len() - at - 1) as u32;
}

fn haystack_of_opt(cell: Option<&DiffCell>) -> String {
    cell.map(haystack_of).unwrap_or_default()
}

fn summarize(rows: &[DiffRow]) -> DiffSummary {
    let mut summary = DiffSummary::default();
    for row in rows {
        match row.status {
            DiffStatus::Changed => summary.changed += 1,
            DiffStatus::Added => summary.added += 1,
            DiffStatus::Removed => summary.removed += 1,
            DiffStatus::Unchanged => summary.unchanged += 1,
        }
    }
    summary
}

fn path_parts(path: &str) -> Vec<&str> {
    path.split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .collect()
}

fn same_suffix(a: &[&str], b: &[&str], depth: usize) -> bool {
    let left = a[a.len().saturating_sub(depth)..].join("/");
    let right = b[b.len().saturating_sub(depth)..].join("/");
    left == right
}

fn labels_for(left: &FileLabel, right: &FileLabel) -> [String; 2] {
    let same_input = left.name != right.name || left.path == right.path;
    if same_input {
        return [left.name.clone(), right.name.clone()];
    }
    let a = path_parts(&left.path);
    let b = path_parts(&right.path);
    let max_depth = a.len().max(b.len());
    let mut depth = 1;
    while depth < max_depth && same_suffix(&a, &b, depth) {
        depth += 1;
    }
    [
        a[a.len().saturating_sub(depth)..].join("/"),
        b[b.len().saturating_sub(depth)..].join("/"),
    ]
}

/// One side of a comparison: its label, header, rows and range lookup.
pub struct DiffSide<'a> {
    pub label: FileLabel,
    pub header: DiffHeader,
    pub rows: &'a [Row],
    pub range: &'a dyn Fn(&str) -> Option<Range>,
}

/// Builds the diff document for two row sets. Strict mode only for now.
pub fn build_diff_document(
    left: DiffSide<'_>,
    right: DiffSide<'_>,
    options: &DiffOptions,
) -> Result<DiffDocument, String> {
    if options.semantic_matching {
        return Err("semantic matching is not ported yet".to_string());
    }
    let left_tree = tree_of(left.rows);
    let right_tree = tree_of(right.rows);
    let merged = merge_children(
        &left_tree,
        left.rows,
        &left_tree.roots,
        &right_tree,
        right.rows,
        &right_tree.roots,
        left.range,
        right.range,
    );
    let mut rows = Vec::new();
    let count = merged.len() as u32;
    for (index, node) in merged.iter().enumerate() {
        flatten(node, None, 1, index as u32 + 1, count, &mut rows);
    }
    Ok(DiffDocument {
        labels: labels_for(&left.label, &right.label),
        left: left.label,
        right: right.label,
        left_header: left.header,
        right_header: right.header,
        summary: summarize(&rows),
        rows,
        semantic_skipped: 0,
        semantic_limit_reason: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ecuc::Document;

    const DOC: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
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
                  <VALUE>1</VALUE>
                </ECUC-NUMERICAL-PARAM-VALUE>
              </PARAMETER-VALUES>
            </ECUC-CONTAINER-VALUE>
          </CONTAINERS>
        </ECUC-MODULE-CONFIGURATION-VALUES>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>
"#;

    fn diff_text(left_text: &str, right_text: &str) -> DiffDocument {
        let left = Document::new(left_text.to_string());
        let right = Document::new(right_text.to_string());
        let left_lookup = |id: &str| left.index().get(id).map(|entry| entry.range);
        let right_lookup = |id: &str| right.index().get(id).map(|entry| entry.range);
        build_diff_document(
            DiffSide {
                label: FileLabel {
                    name: "left.arxml".into(),
                    path: "left.arxml".into(),
                },
                header: DiffHeader::default(),
                rows: left.rows(),
                range: &left_lookup,
            },
            DiffSide {
                label: FileLabel {
                    name: "right.arxml".into(),
                    path: "right.arxml".into(),
                },
                header: DiffHeader::default(),
                rows: right.rows(),
                range: &right_lookup,
            },
            &DiffOptions {
                semantic_matching: false,
            },
        )
        .expect("strict diff builds")
    }

    #[test]
    fn a_self_diff_is_all_unchanged() {
        let document = diff_text(DOC, DOC);
        assert_eq!(document.summary.unchanged as usize, document.rows.len());
        assert_eq!(document.summary.changed, 0);
        assert_eq!(document.summary.added, 0);
        assert_eq!(document.summary.removed, 0);
        assert!(document.rows.iter().all(|row| row.changes.is_empty()));
        assert!(document
            .rows
            .iter()
            .all(|row| row.left.is_some() && row.right.is_some()));
    }

    #[test]
    fn rows_carry_tree_positions() {
        let document = diff_text(DOC, DOC);
        let module = &document.rows[0];
        assert_eq!(module.level, 1);
        assert_eq!((module.posinset, module.setsize), (1, 1));
        assert_eq!(module.parent_key, None);
        let exit = &document.rows[document.rows.len() - 1];
        assert_eq!(exit.subtree_size, 0);
        let child = document
            .rows
            .iter()
            .find(|row| row.parent_key.as_deref() == Some(module.key.as_str()))
            .expect("module has children");
        assert_eq!(child.level, 2);
        let siblings = document
            .rows
            .iter()
            .filter(|row| row.parent_key.as_deref() == Some(module.key.as_str()))
            .count() as u32;
        assert_eq!(child.setsize, siblings);
    }

    #[test]
    fn a_value_edit_marks_the_parameter_changed() {
        let document = diff_text(DOC, &DOC.replace("<VALUE>1</VALUE>", "<VALUE>2</VALUE>"));
        let changed: Vec<&DiffRow> = document
            .rows
            .iter()
            .filter(|row| row.status == DiffStatus::Changed)
            .collect();
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].changes.len(), 1);
        assert_eq!(changed[0].changes[0].field, "value");
        assert_eq!(changed[0].changes[0].left, "1");
        assert_eq!(changed[0].changes[0].right, "2");
        assert_eq!(document.summary.changed, 1);
    }

    #[test]
    fn an_added_container_is_right_only_and_prefixed() {
        let extra = r#"            <ECUC-CONTAINER-VALUE>
              <SHORT-NAME>More</SHORT-NAME>
              <DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Pkg/Mod/More</DEFINITION-REF>
            </ECUC-CONTAINER-VALUE>
"#;
        let right_text = DOC.replace(
            "          </CONTAINERS>",
            &format!("{extra}          </CONTAINERS>"),
        );
        let document = diff_text(DOC, &right_text);
        let added: Vec<&DiffRow> = document
            .rows
            .iter()
            .filter(|row| row.status == DiffStatus::Added)
            .collect();
        assert_eq!(added.len(), 1);
        assert!(added[0].key.starts_with(ADDED_KEY_PREFIX));
        assert!(added[0].left.is_none());
        assert!(added[0].right.is_some());
        assert_eq!(document.summary.added, 1);
    }

    #[test]
    fn a_removed_parameter_keeps_its_left_key() {
        let right_text = DOC.replace(
            r#"              <PARAMETER-VALUES>
                <ECUC-NUMERICAL-PARAM-VALUE>
                  <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/Mod/Cont/P</DEFINITION-REF>
                  <VALUE>1</VALUE>
                </ECUC-NUMERICAL-PARAM-VALUE>
              </PARAMETER-VALUES>
"#,
            "",
        );
        let document = diff_text(DOC, &right_text);
        let removed: Vec<&DiffRow> = document
            .rows
            .iter()
            .filter(|row| row.status == DiffStatus::Removed)
            .collect();
        assert_eq!(removed.len(), 1);
        assert!(!removed[0].key.starts_with(ADDED_KEY_PREFIX));
        assert!(removed[0].right.is_none());
        assert_eq!(document.summary.removed, 1);
    }

    #[test]
    fn ranges_are_utf16_code_units() {
        let text = DOC.replace(
            "  <AR-PACKAGES>",
            "  <!-- a comment with é in it -->\n  <AR-PACKAGES>",
        );
        let byte = text
            .find("<ECUC-MODULE-CONFIGURATION-VALUES>")
            .expect("module tag");
        let expected = text[..byte].encode_utf16().count() as u32;
        let document = diff_text(&text, &text);
        let module = &document.rows[0];
        assert_eq!(
            module.left.as_ref().expect("left cell").range.start,
            expected
        );
        assert_ne!(
            expected as usize, byte,
            "the fixture must contain a multi-byte character"
        );
    }
}
