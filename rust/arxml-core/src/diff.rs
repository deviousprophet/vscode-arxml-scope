//! The semantic-diff model: a parity-exact port of the TypeScript builder.
//!
//! Rows are the engine's own `Row` values; the comparison needs no model, only the
//! rows and their element ranges. The result is the document the diff panel embeds.
//!
//! Two pairing paths live here. The strict pass pairs children by content, exact id
//! and an ordinal-free fallback; the semantic pass then pairs leftover modules and
//! containers by a weighted score and learns rename substitutions from the pairs it
//! accepts. Both are ports of `src/core/diff/diffModel.ts`, and `npm run parity:diff`
//! compares whole documents against it.

use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use serde::Serialize;

pub mod patch;

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

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchReasons {
    pub children: f64,
    pub name: f64,
    pub position: f64,
    pub substitution: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffMatch {
    pub kind: String,
    pub score: f64,
    pub reasons: MatchReasons,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub substitutions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback: Option<bool>,
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
    #[serde(rename = "match", skip_serializing_if = "Option::is_none")]
    pub match_: Option<DiffMatch>,
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

/// Both sides' range lookups: one per compared document.
#[derive(Clone, Copy)]
struct Ranges<'a> {
    left: RangeLookup<'a>,
    right: RangeLookup<'a>,
}

#[derive(Clone, Debug, Default, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiffOptions {
    pub semantic_matching: bool,
    /// Deterministic cap on scored semantic pairs. The default is the module budget;
    /// exposed so a test can exercise the limited path. Host code must not set it.
    pub semantic_pair_budget: Option<u32>,
}

/// One side of a comparison: its label, header, rows and range lookup.
pub struct DiffSide<'a> {
    pub label: FileLabel,
    pub header: DiffHeader,
    pub rows: &'a [Row],
    pub range: RangeLookup<'a>,
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
    tree.roots = build_level(rows, 0, rows.len(), &mut tree);
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

/// One side of the comparison's tree plus the rows it indexes.
#[derive(Clone, Copy)]
struct Side<'a> {
    tree: &'a Tree,
    rows: &'a [Row],
}

impl<'a> Side<'a> {
    fn new(tree: &'a Tree, rows: &'a [Row]) -> Self {
        Self { tree, rows }
    }

    fn row(&self, node: usize) -> &'a Row {
        &self.rows[self.tree.nodes[node].row]
    }

    fn children(&self, node: usize) -> &'a [usize] {
        &self.tree.nodes[node].children
    }
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

fn variant_text(cell: &DiffCell) -> String {
    cell.meta
        .iter()
        .filter(|part| part.cls == "variant")
        .map(|part| part.text.as_str())
        .collect::<Vec<_>>()
        .join(",")
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

fn subtree_identity(side: Side, node: usize) -> String {
    let content = content_identity(side.row(node));
    let children = side.children(node);
    if children.is_empty() {
        return content;
    }
    let joined = children
        .iter()
        .map(|child| subtree_identity(side, *child))
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

fn name_of(side: Side, node: usize) -> String {
    let row = side.row(node);
    match row.short_name.clone() {
        Some(name) if !name.is_empty() => name,
        _ => row.label.clone(),
    }
}

/// Tokens as the model sees them: ASCII alphanumeric runs.
fn tokens_of(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut token = String::new();
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() {
            token.push(ch);
        } else if !token.is_empty() {
            out.push(std::mem::take(&mut token));
        }
    }
    if !token.is_empty() {
        out.push(token);
    }
    out
}

fn token_set(text: &str) -> HashSet<String> {
    tokens_of(text).into_iter().collect()
}

/// Learned `old→new` token changes, in the order they were learned.
type Substitutions = Rc<RefCell<Vec<(String, String)>>>;

fn apply_substitutions(text: &str, substitutions: &Substitutions) -> String {
    let substitutions = substitutions.borrow();
    if substitutions.is_empty() {
        return text.to_string();
    }
    let mut ordered: Vec<&(String, String)> = substitutions.iter().collect();
    ordered.sort_by_key(|entry| std::cmp::Reverse(entry.0.len()));
    let mut out = String::with_capacity(text.len());
    let mut token = String::new();
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() {
            token.push(ch);
            continue;
        }
        push_replaced(&mut out, &token, &ordered);
        out.push(ch);
        token.clear();
    }
    push_replaced(&mut out, &token, &ordered);
    out
}

fn push_replaced(out: &mut String, token: &str, ordered: &[&(String, String)]) {
    if token.is_empty() {
        return;
    }
    match ordered.iter().find(|(old, _)| old == token) {
        Some((_, next)) => out.push_str(next),
        None => out.push_str(token),
    }
}

fn has_substitution(substitutions: &Substitutions, old: &str) -> bool {
    substitutions.borrow().iter().any(|(key, _)| key == old)
}

fn learn_substitution(substitutions: &Substitutions, old: &str, next: &str) {
    substitutions
        .borrow_mut()
        .push((old.to_string(), next.to_string()));
}

fn substitution_count(substitutions: &Substitutions) -> usize {
    substitutions.borrow().len()
}

fn token_changes(left: &str, right: &str) -> Vec<(String, String)> {
    let a = tokens_of(left);
    let b = tokens_of(right);
    let mut out = Vec::new();
    let mut i = 0;
    let mut j = 0;
    while i < a.len() && j < b.len() {
        if a[i] == b[j] {
            i += 1;
            j += 1;
            continue;
        }
        out.push((a[i].clone(), b[j].clone()));
        i += 1;
        j += 1;
    }
    out
}

fn is_numeric_token(text: &str) -> bool {
    !text.is_empty() && text.chars().all(|ch| ch.is_ascii_digit())
}

fn is_usable_change(old: &str, next: &str) -> bool {
    old.len() >= 2 && next.len() >= 2 && !is_numeric_token(old) && !is_numeric_token(next)
}

fn usable_token_changes(left: &str, right: &str) -> Vec<(String, String)> {
    token_changes(left, right)
        .into_iter()
        .filter(|(old, next)| is_usable_change(old, next))
        .collect()
}

fn round(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

fn levenshtein(left: &[u16], right: &[u16]) -> usize {
    let mut previous: Vec<usize> = (0..=right.len()).collect();
    let mut current = vec![0usize; right.len() + 1];
    for row in 1..=left.len() {
        current[0] = row;
        for column in 1..=right.len() {
            current[column] = (previous[column] + 1)
                .min(current[column - 1] + 1)
                .min(previous[column - 1] + usize::from(left[row - 1] != right[column - 1]));
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right.len()]
}

fn token_intersection(left: &HashSet<String>, right: &HashSet<String>) -> usize {
    left.iter().filter(|token| right.contains(*token)).count()
}

fn token_jaccard(left: &HashSet<String>, right: &HashSet<String>) -> f64 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let intersection = token_intersection(left, right);
    let union = left.len() + right.len() - intersection;
    if union == 0 {
        return 0.0;
    }
    intersection as f64 / union as f64
}

fn name_similarity(
    left_name: &str,
    left_tokens: &HashSet<String>,
    right_name: &str,
    right_tokens: &HashSet<String>,
) -> f64 {
    if left_name.is_empty() || right_name.is_empty() {
        return 0.0;
    }
    let union = left_tokens.union(right_tokens).count();
    let jaccard = if union == 0 {
        0.0
    } else {
        token_intersection(left_tokens, right_tokens) as f64 / union as f64
    };
    let left: Vec<u16> = left_name.encode_utf16().collect();
    let right: Vec<u16> = right_name.encode_utf16().collect();
    let distance = levenshtein(&left, &right) as f64;
    let longest = left.len().max(right.len()).max(1) as f64;
    let similarity = 1.0 - distance / longest;
    0.5 * jaccard + 0.5 * similarity
}

fn renames_to_one_side(left_name: &str, right_name: &str, substitutions: &Substitutions) -> bool {
    apply_substitutions(left_name, substitutions) == right_name
        || apply_substitutions(right_name, substitutions) == left_name
}

fn blob_mentions_substitution(blob: &str, substitutions: &Substitutions) -> bool {
    let substitutions = substitutions.borrow();
    substitutions
        .iter()
        .any(|(old, _)| blob.contains(old.as_str()))
}

fn child_blob(side: Side, node: usize) -> String {
    side.children(node)
        .iter()
        .map(|child| {
            format!(
                "{} {}",
                name_of(side, *child),
                sort_identity(side.row(*child))
            )
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn substitution_score(
    side: Side,
    left: usize,
    right: Side,
    right_node: usize,
    substitutions: &Substitutions,
) -> f64 {
    if substitution_count(substitutions) == 0 {
        return 0.0;
    }
    let left_name = name_of(side, left);
    let right_name = name_of(right, right_node);
    if renames_to_one_side(&left_name, &right_name, substitutions) {
        return 1.0;
    }
    let blob = format!(
        "{} {} {} {}",
        left_name,
        right_name,
        child_blob(side, left),
        child_blob(right, right_node)
    );
    if blob_mentions_substitution(&blob, substitutions) {
        0.5
    } else {
        0.0
    }
}

fn substitutions_used(
    side: Side,
    left: usize,
    right: Side,
    right_node: usize,
    substitutions: &Substitutions,
) -> Vec<String> {
    let blob = format!(
        "{} {} {} {}",
        name_of(side, left),
        name_of(right, right_node),
        child_blob(side, left),
        child_blob(right, right_node)
    );
    substitutions
        .borrow()
        .iter()
        .filter(|(old, _)| blob.contains(old.as_str()))
        .map(|(old, next)| format!("{old}\u{2192}{next}"))
        .collect()
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

fn group_by<F>(nodes: &[usize], key_of: F) -> OrderedGroups
where
    F: Fn(usize) -> String,
{
    let mut groups = OrderedGroups::default();
    for node in nodes {
        groups.push(key_of(*node), *node);
    }
    groups
}

fn group_by_base(side: Side, nodes: &[usize], relative: bool) -> OrderedGroups {
    group_by(nodes, |node| {
        let id = &side.row(node).id;
        let scoped = if relative {
            relative_id(id)
        } else {
            id.as_str()
        };
        base_id(scoped)
    })
}

/// The comparison state: learned substitutions are shared, counters are per context.
struct Context {
    relative: bool,
    semantic: bool,
    substitutions: Substitutions,
    semantic_skipped: u32,
    semantic_budget_used: u32,
    semantic_budget_limit: u32,
    semantic_budget_hit: bool,
    semantic_budget_skipped: u32,
    semantic_fallback_skipped: u32,
    semantic_limit_reason: Option<String>,
}

impl Context {
    fn new(semantic: bool, budget: u32) -> Self {
        Self {
            relative: false,
            semantic,
            substitutions: Rc::new(RefCell::new(Vec::new())),
            semantic_skipped: 0,
            semantic_budget_used: 0,
            semantic_budget_limit: budget,
            semantic_budget_hit: false,
            semantic_budget_skipped: 0,
            semantic_fallback_skipped: 0,
            semantic_limit_reason: None,
        }
    }

    /// A child context: the same learned substitutions, its own counters — the
    /// TypeScript builder spreads the context object for a semantic pair's children.
    fn child(&self, relative: bool) -> Self {
        Self {
            relative,
            semantic: self.semantic,
            substitutions: Rc::clone(&self.substitutions),
            semantic_skipped: self.semantic_skipped,
            semantic_budget_used: self.semantic_budget_used,
            semantic_budget_limit: self.semantic_budget_limit,
            semantic_budget_hit: self.semantic_budget_hit,
            semantic_budget_skipped: self.semantic_budget_skipped,
            semantic_fallback_skipped: self.semantic_fallback_skipped,
            semantic_limit_reason: self.semantic_limit_reason.clone(),
        }
    }
}

struct Pairing {
    match_of_right: HashMap<usize, usize>,
    matched_left: HashSet<usize>,
    matches: HashMap<usize, DiffMatch>,
}

impl Pairing {
    fn new() -> Self {
        Self {
            match_of_right: HashMap::new(),
            matched_left: HashSet::new(),
            matches: HashMap::new(),
        }
    }

    fn try_pair(&mut self, right: usize, left: usize, found: Option<DiffMatch>) -> bool {
        if self.match_of_right.contains_key(&right) || self.matched_left.contains(&left) {
            return false;
        }
        self.match_of_right.insert(right, left);
        self.matched_left.insert(left);
        if let Some(found) = found {
            self.matches.insert(left, found);
        }
        true
    }
}

fn keys_for<F>(nodes: &[usize], key: F) -> HashMap<usize, String>
where
    F: Fn(usize) -> String,
{
    nodes.iter().map(|node| (*node, key(*node))).collect()
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
            if pairing.try_pair(*right, *left, None) {
                break;
            }
        }
    }
}

fn pair_identity_groups(
    left: Side,
    lefts: &[usize],
    right: Side,
    rights: &[usize],
    relative: bool,
    pairing: &mut Pairing,
) {
    let left_by_base = group_by_base(left, lefts, relative);
    let right_by_base = group_by_base(right, rights, relative);
    for (base, left_group) in left_by_base.iter() {
        let Some(right_group) = right_by_base.get(base) else {
            continue;
        };
        if left_group.len() == 1 && right_group.len() == 1 {
            continue;
        }
        let left_subtree = keys_for(left_group, |node| subtree_identity(left, node));
        let right_subtree = keys_for(right_group, |node| subtree_identity(right, node));
        pair_by_key(
            left_group,
            right_group,
            &left_subtree,
            &right_subtree,
            pairing,
        );
        let left_sort = keys_for(left_group, |node| sort_identity(left.row(node)));
        let right_sort = keys_for(right_group, |node| sort_identity(right.row(node)));
        pair_by_key(left_group, right_group, &left_sort, &right_sort, pairing);
    }
}

fn pair_by_identity(
    left: Side,
    lefts: &[usize],
    right: Side,
    rights: &[usize],
    pairing: &mut Pairing,
) {
    let mut right_by_id: HashMap<String, usize> = HashMap::new();
    for right_node in rights {
        right_by_id.insert(right.row(*right_node).id.clone(), *right_node);
    }
    for left_node in lefts {
        if pairing.matched_left.contains(left_node) {
            continue;
        }
        let id = &left.row(*left_node).id;
        if let Some(right_node) = right_by_id.get(id) {
            pairing.try_pair(*right_node, *left_node, None);
        }
    }
}

fn pair_by_base_fallback(
    left: Side,
    lefts: &[usize],
    right: Side,
    rights: &[usize],
    relative: bool,
    pairing: &mut Pairing,
) {
    let left_rest = group_by_base(left, lefts, relative);
    let right_rest = group_by_base(right, rights, relative);
    let mut candidates = Vec::new();
    for (base, left_group) in left_rest.iter() {
        if let Some(right_group) = right_rest.get(base) {
            if left_group.len() == 1 && right_group.len() == 1 {
                candidates.push((right_group[0], left_group[0]));
            }
        }
    }
    for (right_node, left_node) in candidates {
        pairing.try_pair(right_node, left_node, None);
    }
}

/// Pairs one level's children: identity groups, exact id, ordinal-free fallback,
/// then the semantic pass.
fn pair_level(
    left: Side,
    lefts: &[usize],
    right: Side,
    rights: &[usize],
    context: &mut Context,
) -> Pairing {
    let mut pairing = Pairing::new();
    pair_identity_groups(left, lefts, right, rights, context.relative, &mut pairing);
    pair_by_identity(left, lefts, right, rights, &mut pairing);
    pair_by_base_fallback(left, lefts, right, rights, context.relative, &mut pairing);
    if context.semantic {
        semantic_pass(left, lefts, right, rights, context, &mut pairing);
    }
    pairing
}

// ---------------------------------------------------------------------------
// Semantic matching
// ---------------------------------------------------------------------------

/// Above this product, a bucket uses candidate blocking instead of scoring every pair.
const SEMANTIC_FULL_SCORE_PRODUCT: usize = 4_096;
/// Deterministic caps; a candidate count, not a wall clock.
const SEMANTIC_MAX_CANDIDATES_PER_NODE: usize = 48;
const SEMANTIC_MAX_TOTAL_CANDIDATES: usize = 50_000;
const SEMANTIC_SCORE_BUDGET: u32 = 250_000;
/// Number of nearest positions added so a near-tie still has a second score.
const SEMANTIC_POSITION_NEIGHBOURS: usize = 2;

/// Above this product, a bucket uses the linear fallback instead of scoring every pair.
const SEMANTIC_PAIR_LIMIT: usize = 250_000;
const SEMANTIC_SCORE_FLOOR: f64 = 0.62;
const SEMANTIC_MARGIN: f64 = 0.08;
/// Token-Jaccard floor for choosing name seeds; the full name score gates learning.
const SEMANTIC_NAME_SEED_FLOOR: f64 = 0.55;
const SEMANTIC_LEARN_SCORE: f64 = 0.62;

/// One leftover container prepared for the semantic scorer. The child multiset
/// and token set are built once per pass; scoring every pair reuses them.
struct SemanticNode {
    node: usize,
    /// Position in the bucket, used for the deterministic position score.
    index: usize,
    /// Original name, used by the substitution reason.
    name: String,
    /// Name after learned substitutions, lower-cased.
    substituted: String,
    tokens: HashSet<String>,
    /// Digit-collapsed name; bulk renames share one signature after learning.
    signature: String,
    child_keys: HashMap<String, u32>,
    /// Order-independent child-key identity; empty string means no children.
    child_key_signature: String,
    /// Original child names/identities, built once for the substitution score.
    child_blob: String,
}

fn collapse_digits(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_digits = false;
    for ch in text.chars() {
        if ch.is_ascii_digit() {
            if !in_digits {
                out.push('#');
                in_digits = true;
            }
        } else {
            in_digits = false;
            out.push(ch);
        }
    }
    out
}

fn child_key(side: Side, node: usize, substitutions: &Substitutions) -> String {
    let row = side.row(node);
    format!(
        "{}|{}|{}",
        row.kind,
        row.definition_ref,
        apply_substitutions(&sort_identity(row), substitutions)
    )
}

fn semantic_nodes(side: Side, nodes: &[usize], substitutions: &Substitutions) -> Vec<SemanticNode> {
    nodes
        .iter()
        .enumerate()
        .map(|(index, node)| {
            let name = name_of(side, *node);
            let substituted = apply_substitutions(&name, substitutions).to_lowercase();
            let mut child_keys: HashMap<String, u32> = HashMap::new();
            for child in side.children(*node) {
                let key = child_key(side, *child, substitutions);
                *child_keys.entry(key).or_insert(0) += 1;
            }
            SemanticNode {
                node: *node,
                index,
                signature: collapse_digits(&substituted),
                tokens: token_set(&substituted),
                substituted,
                name,
                child_key_signature: if child_keys.is_empty() {
                    String::new()
                } else {
                    counts_signature(&child_keys)
                },
                child_blob: child_blob(side, *node),
                child_keys,
            }
        })
        .collect()
}

fn counts_signature(counts: &HashMap<String, u32>) -> String {
    let mut entries: Vec<(&String, &u32)> = counts.iter().collect();
    entries.sort_by(|a, b| a.0.cmp(b.0));
    entries
        .iter()
        .map(|(key, count)| format!("{key}\u{0}{count}"))
        .collect::<Vec<_>>()
        .join("\u{1}")
}

fn child_count(counts: &HashMap<String, u32>) -> u32 {
    counts.values().sum()
}

fn multiset_score(left: &HashMap<String, u32>, right: &HashMap<String, u32>) -> f64 {
    let mut keys: HashSet<&String> = left.keys().collect();
    keys.extend(right.keys());
    let mut intersection = 0u32;
    let mut union = 0u32;
    for key in keys {
        let left_count = left.get(key).copied().unwrap_or(0);
        let right_count = right.get(key).copied().unwrap_or(0);
        intersection += left_count.min(right_count);
        union += left_count.max(right_count);
    }
    if union == 0 {
        1.0
    } else {
        intersection as f64 / union as f64
    }
}

fn children_score(left: &SemanticNode, right: &SemanticNode) -> f64 {
    let left_size = child_count(&left.child_keys);
    let right_size = child_count(&right.child_keys);
    if left_size == 0 && right_size == 0 {
        return 1.0;
    }
    if left_size == 0 || right_size == 0 {
        return 0.0;
    }
    multiset_score(&left.child_keys, &right.child_keys)
}

fn name_score_nodes(left: &SemanticNode, right: &SemanticNode) -> f64 {
    name_similarity(
        &left.substituted,
        &left.tokens,
        &right.substituted,
        &right.tokens,
    )
}

fn position_score_nodes(
    left: &SemanticNode,
    right: &SemanticNode,
    left_count: usize,
    right_count: usize,
) -> f64 {
    let distance = (left.index as f64 - right.index as f64).abs();
    let span = left_count.max(right_count).max(1) as f64;
    (1.0 - distance / span).clamp(0.0, 1.0)
}

fn substitution_score_nodes(
    left: &SemanticNode,
    right: &SemanticNode,
    substitutions: &Substitutions,
) -> f64 {
    if substitution_count(substitutions) == 0 {
        return 0.0;
    }
    if renames_to_one_side(&left.name, &right.name, substitutions) {
        return 1.0;
    }
    let blob = format!(
        "{} {} {} {}",
        left.name, right.name, left.child_blob, right.child_blob
    );
    if blob_mentions_substitution(&blob, substitutions) {
        0.5
    } else {
        0.0
    }
}

struct SemanticScore {
    score: f64,
    reasons: MatchReasons,
}

fn score_semantic_node(
    left: &SemanticNode,
    right: &SemanticNode,
    left_count: usize,
    right_count: usize,
    substitutions: &Substitutions,
) -> SemanticScore {
    let children = children_score(left, right);
    if children == 0.0 {
        return SemanticScore {
            score: 0.0,
            reasons: MatchReasons {
                children: 0.0,
                name: 0.0,
                position: 0.0,
                substitution: 0.0,
            },
        };
    }
    let name = name_score_nodes(left, right);
    let position = position_score_nodes(left, right, left_count, right_count);
    let substitution = substitution_score_nodes(left, right, substitutions);
    let score = 0.55 * children + 0.3 * name + 0.1 * position + 0.05 * substitution;
    SemanticScore {
        score,
        reasons: MatchReasons {
            children: round(children),
            name: round(name),
            position: round(position),
            substitution: round(substitution),
        },
    }
}

/// One scored pair, in the bucket's own node indices.
#[derive(Clone)]
struct SemanticPair {
    left: usize,
    right: usize,
    score: f64,
    reasons: MatchReasons,
}

struct SemanticBucket {
    lefts: Vec<usize>,
    rights: Vec<usize>,
}

fn bucket_by_definition(side: Side, nodes: &[usize]) -> OrderedGroups {
    group_by(nodes, |node| side.row(node).definition_ref.clone())
}

fn semantic_buckets(
    left: Side,
    lefts: &[usize],
    right: Side,
    rights: &[usize],
) -> (Vec<SemanticBucket>, Vec<SemanticBucket>) {
    let left_groups = bucket_by_definition(left, lefts);
    let right_groups = bucket_by_definition(right, rights);
    let mut normal = Vec::new();
    let mut oversized = Vec::new();
    for (definition, left_group) in left_groups.iter() {
        let Some(right_group) = right_groups.get(definition) else {
            continue;
        };
        let bucket = SemanticBucket {
            lefts: left_group.clone(),
            rights: right_group.clone(),
        };
        if bucket.lefts.len() * bucket.rights.len() > SEMANTIC_PAIR_LIMIT {
            oversized.push(bucket);
        } else {
            normal.push(bucket);
        }
    }
    (normal, oversized)
}

fn assign_semantic(
    left: Side,
    lefts: &[usize],
    right: Side,
    rights: &[usize],
    context: &mut Context,
) -> Vec<SemanticPair> {
    let left_nodes = semantic_nodes(left, lefts, &context.substitutions);
    let right_nodes = semantic_nodes(right, rights, &context.substitutions);
    let candidate_nodes = collect_semantic_candidates(&left_nodes, &right_nodes, context);
    if candidate_nodes.is_empty() {
        return Vec::new();
    }
    let (considered, budget_limited) = budget_slice(candidate_nodes, context);
    let candidates = score_candidates(
        &considered,
        &left_nodes,
        &right_nodes,
        &context.substitutions,
    );
    if candidates.is_empty() {
        return Vec::new();
    }
    let scores = candidate_scores(&candidates);
    let mut accepted: Vec<SemanticPair> = candidates
        .iter()
        .filter(|candidate| accepted_candidate(candidate, &scores))
        .cloned()
        .collect();
    accepted.sort_by(|a, b| compare_semantic_pairs(a, b, left, right));
    let out = greedy_pairs(&accepted);
    if budget_limited {
        return out;
    }
    merge_identical_children(left, lefts, right, rights, out, &candidates, context)
}

fn rescore_if_learned(
    left: Side,
    lefts: &[usize],
    right: Side,
    rights: &[usize],
    pairs: Vec<SemanticPair>,
    context: &mut Context,
) -> Vec<SemanticPair> {
    if context.semantic_budget_hit {
        return pairs;
    }
    if !learn_substitutions(left, right, &pairs, &context.substitutions, 0.8, false) {
        return pairs;
    }
    assign_semantic(left, lefts, right, rights, context)
}

fn rescore_from_names(
    left: Side,
    lefts: &[usize],
    right: Side,
    rights: &[usize],
    pairs: Vec<SemanticPair>,
    context: &mut Context,
) -> Vec<SemanticPair> {
    if context.semantic_budget_hit {
        return pairs;
    }
    if pairs.len() >= lefts.len().min(rights.len()) {
        return pairs;
    }
    if !learn_name_substitutions(left, lefts, right, rights, &context.substitutions) {
        return pairs;
    }
    assign_semantic(left, lefts, right, rights, context)
}

fn learn_loop(
    left: Side,
    lefts: &[usize],
    right: Side,
    rights: &[usize],
    pairs: Vec<SemanticPair>,
    context: &mut Context,
) -> Vec<SemanticPair> {
    let mut current = pairs;
    for _ in 0..3 {
        if context.semantic_budget_hit {
            break;
        }
        if !learn_substitutions(
            left,
            right,
            &current,
            &context.substitutions,
            SEMANTIC_LEARN_SCORE,
            false,
        ) {
            break;
        }
        current = assign_semantic(left, lefts, right, rights, context);
    }
    current
}

fn semantic_match(pair: &SemanticPair, used: Vec<String>) -> DiffMatch {
    DiffMatch {
        kind: "semantic".to_string(),
        score: pair.score,
        reasons: pair.reasons,
        substitutions: if used.is_empty() { None } else { Some(used) },
        fallback: None,
    }
}

fn fallback_match(pair: &SemanticPair) -> DiffMatch {
    DiffMatch {
        kind: "semantic".to_string(),
        score: pair.score,
        reasons: pair.reasons,
        substitutions: None,
        fallback: Some(true),
    }
}

fn accept_pairs(
    left: Side,
    right: Side,
    pairs: &[SemanticPair],
    context: &Context,
    pairing: &mut Pairing,
) {
    for pair in pairs {
        let used = substitutions_used(left, pair.left, right, pair.right, &context.substitutions);
        pairing.try_pair(pair.right, pair.left, Some(semantic_match(pair, used)));
    }
}

fn unpaired_count(lefts: &[usize], rights: &[usize], pairs: &[SemanticPair]) -> u32 {
    let paired_left: HashSet<usize> = pairs.iter().map(|pair| pair.left).collect();
    let paired_right: HashSet<usize> = pairs.iter().map(|pair| pair.right).collect();
    (lefts.len() - paired_left.len()) as u32 + (rights.len() - paired_right.len()) as u32
}

fn note_budget_skipped(
    lefts: &[usize],
    rights: &[usize],
    pairs: &[SemanticPair],
    context: &mut Context,
) {
    if !context.semantic_budget_hit {
        return;
    }
    let unpaired = unpaired_count(lefts, rights, pairs);
    context.semantic_budget_skipped += unpaired;
    context.semantic_skipped += unpaired;
}

/// The original path: score, learn from high-confidence pairs, score again.
fn run_normal_bucket(
    bucket: &SemanticBucket,
    left: Side,
    right: Side,
    context: &mut Context,
    pairing: &mut Pairing,
) {
    let pairs = assign_semantic(left, &bucket.lefts, right, &bucket.rights, context);
    let pairs = rescore_if_learned(left, &bucket.lefts, right, &bucket.rights, pairs, context);
    let pairs = rescore_from_names(left, &bucket.lefts, right, &bucket.rights, pairs, context);
    let pairs = learn_loop(left, &bucket.lefts, right, &bucket.rights, pairs, context);
    accept_pairs(left, right, &pairs, context, pairing);
    note_budget_skipped(&bucket.lefts, &bucket.rights, &pairs, context);
}

fn run_oversized_bucket(
    bucket: &SemanticBucket,
    left: Side,
    right: Side,
    context: &mut Context,
    pairing: &mut Pairing,
) {
    // Learn the rename from names before the name-key fallback. Without this,
    // a single above-limit bucket has no normal bucket to teach it a
    // substitution and its fallback pairs nothing.
    learn_name_substitutions(
        left,
        &bucket.lefts,
        right,
        &bucket.rights,
        &context.substitutions,
    );
    let pairs = assign_fallback(
        left,
        &bucket.lefts,
        right,
        &bucket.rights,
        &context.substitutions,
    );
    for pair in &pairs {
        pairing.try_pair(pair.right, pair.left, Some(fallback_match(pair)));
    }
    let unpaired = unpaired_count(&bucket.lefts, &bucket.rights, &pairs);
    context.semantic_fallback_skipped += unpaired;
    context.semantic_skipped += unpaired;
}

fn update_limit_reason(context: &mut Context) {
    if context.semantic_skipped == 0 {
        return;
    }
    if context.semantic_budget_skipped > context.semantic_fallback_skipped {
        context.semantic_limit_reason = Some("budget".to_string());
        return;
    }
    let reason = if context.semantic_fallback_skipped > 0 {
        "fallback"
    } else {
        "budget"
    };
    context.semantic_limit_reason = Some(reason.to_string());
}

/// Pairs leftover modules and containers with the same parent and definition ref.
fn semantic_pass(
    left: Side,
    left_children: &[usize],
    right: Side,
    right_children: &[usize],
    context: &mut Context,
    pairing: &mut Pairing,
) {
    let lefts: Vec<usize> = left_children
        .iter()
        .copied()
        .filter(|node| !pairing.matched_left.contains(node) && is_semantic_kind(left.row(*node)))
        .collect();
    let rights: Vec<usize> = right_children
        .iter()
        .copied()
        .filter(|node| {
            !pairing.match_of_right.contains_key(node) && is_semantic_kind(right.row(*node))
        })
        .collect();
    if lefts.is_empty() || rights.is_empty() {
        return;
    }
    let (normal, oversized) = semantic_buckets(left, &lefts, right, &rights);
    // Normal buckets first: their learned substitutions are what the oversized
    // fallback applies later, independent of the definition's sort order.
    for bucket in &normal {
        run_normal_bucket(bucket, left, right, context, pairing);
    }
    for bucket in &oversized {
        run_oversized_bucket(bucket, left, right, context, pairing);
    }
    update_limit_reason(context);
}

/// Semantic pairing covers modules and containers; parameters and references stay strict.
fn is_semantic_kind(row: &Row) -> bool {
    row.kind == "container" || row.kind == "module"
}

fn record_top_two(
    map: &mut HashMap<usize, f64>,
    second: &mut HashMap<usize, f64>,
    node: usize,
    value: f64,
) {
    match map.get(&node).copied() {
        Some(current) if value > current => {
            second.insert(node, current);
            map.insert(node, value);
        }
        Some(_) => {
            if value > second.get(&node).copied().unwrap_or(0.0) {
                second.insert(node, value);
            }
        }
        None => {
            second.insert(node, map.get(&node).copied().unwrap_or(0.0));
            map.insert(node, value);
        }
    }
}

struct CandidateScores {
    best_left: HashMap<usize, f64>,
    second_left: HashMap<usize, f64>,
    best_right: HashMap<usize, f64>,
    second_right: HashMap<usize, f64>,
}

fn candidate_scores(candidates: &[SemanticPair]) -> CandidateScores {
    let mut scores = CandidateScores {
        best_left: HashMap::new(),
        second_left: HashMap::new(),
        best_right: HashMap::new(),
        second_right: HashMap::new(),
    };
    for candidate in candidates {
        record_top_two(
            &mut scores.best_left,
            &mut scores.second_left,
            candidate.left,
            candidate.score,
        );
        record_top_two(
            &mut scores.best_right,
            &mut scores.second_right,
            candidate.right,
            candidate.score,
        );
    }
    scores
}

fn margin_of(best: &HashMap<usize, f64>, second: &HashMap<usize, f64>, node: usize) -> f64 {
    best.get(&node).copied().unwrap_or(0.0) - second.get(&node).copied().unwrap_or(0.0)
}

fn accepted_candidate(candidate: &SemanticPair, scores: &CandidateScores) -> bool {
    if candidate.score < SEMANTIC_SCORE_FLOOR {
        return false;
    }
    margin_of(&scores.best_left, &scores.second_left, candidate.left) >= SEMANTIC_MARGIN
        && margin_of(&scores.best_right, &scores.second_right, candidate.right) >= SEMANTIC_MARGIN
}

fn compare_semantic_pairs(a: &SemanticPair, b: &SemanticPair, left: Side, right: Side) -> Ordering {
    let by_score = b.score.partial_cmp(&a.score).unwrap_or(Ordering::Equal);
    if by_score != Ordering::Equal {
        return by_score;
    }
    relative_id(&left.row(a.left).id)
        .cmp(relative_id(&left.row(b.left).id))
        .then_with(|| relative_id(&right.row(a.right).id).cmp(relative_id(&right.row(b.right).id)))
}

fn greedy_pairs(accepted: &[SemanticPair]) -> Vec<SemanticPair> {
    let mut used_left = HashSet::new();
    let mut used_right = HashSet::new();
    let mut out = Vec::new();
    for candidate in accepted {
        if used_left.contains(&candidate.left) || used_right.contains(&candidate.right) {
            continue;
        }
        used_left.insert(candidate.left);
        used_right.insert(candidate.right);
        out.push(candidate.clone());
    }
    out
}

fn budget_slice(
    candidate_nodes: Vec<(usize, usize)>,
    context: &mut Context,
) -> (Vec<(usize, usize)>, bool) {
    let remaining = context
        .semantic_budget_limit
        .saturating_sub(context.semantic_budget_used) as usize;
    let budget_limited = candidate_nodes.len() > remaining;
    let considered = if budget_limited {
        candidate_nodes[..remaining].to_vec()
    } else {
        candidate_nodes
    };
    if budget_limited {
        context.semantic_budget_hit = true;
    }
    context.semantic_budget_used += considered.len() as u32;
    (considered, budget_limited)
}

fn score_candidates(
    considered: &[(usize, usize)],
    left_nodes: &[SemanticNode],
    right_nodes: &[SemanticNode],
    substitutions: &Substitutions,
) -> Vec<SemanticPair> {
    considered
        .iter()
        .map(|(left, right)| {
            let scored = score_semantic_node(
                &left_nodes[*left],
                &right_nodes[*right],
                left_nodes.len(),
                right_nodes.len(),
                substitutions,
            );
            SemanticPair {
                left: left_nodes[*left].node,
                right: right_nodes[*right].node,
                score: scored.score,
                reasons: scored.reasons,
            }
        })
        .collect()
}

fn trees_index(trees: &[usize]) -> HashMap<usize, usize> {
    trees
        .iter()
        .enumerate()
        .map(|(at, node)| (*node, at))
        .collect()
}

fn all_children_identical(candidates: &[SemanticPair]) -> bool {
    candidates
        .iter()
        .all(|candidate| candidate.reasons.children >= 0.99)
}

fn remaining_pairs(
    lefts: &[usize],
    rights: &[usize],
    pairs: &[SemanticPair],
) -> (Vec<usize>, Vec<usize>) {
    let used_left: HashSet<usize> = pairs.iter().map(|pair| pair.left).collect();
    let used_right: HashSet<usize> = pairs.iter().map(|pair| pair.right).collect();
    (
        lefts
            .iter()
            .copied()
            .filter(|node| !used_left.contains(node))
            .collect(),
        rights
            .iter()
            .copied()
            .filter(|node| !used_right.contains(node))
            .collect(),
    )
}

// Identical children make every pair score the same, so the 0.08 margin can
// never accept one. Pair the leftovers by name, then by ordinal position.
fn merge_identical_children(
    left: Side,
    lefts: &[usize],
    right: Side,
    rights: &[usize],
    out: Vec<SemanticPair>,
    candidates: &[SemanticPair],
    context: &mut Context,
) -> Vec<SemanticPair> {
    let (remaining_left, remaining_right) = remaining_pairs(lefts, rights, &out);
    if remaining_left.is_empty()
        || remaining_right.is_empty()
        || !all_children_identical(candidates)
    {
        return out;
    }
    let extra = IdenticalWalk {
        left,
        lefts: &remaining_left,
        right,
        rights: &remaining_right,
        left_index: trees_index(lefts),
        right_index: trees_index(rights),
        substitutions: &context.substitutions,
    }
    .run();
    let mut merged = out;
    merged.extend(extra);
    merged
}

/// Deterministic pairing for buckets whose children are all identical.
struct IdenticalWalk<'a> {
    left: Side<'a>,
    lefts: &'a [usize],
    right: Side<'a>,
    rights: &'a [usize],
    left_index: HashMap<usize, usize>,
    right_index: HashMap<usize, usize>,
    substitutions: &'a Substitutions,
}

impl IdenticalWalk<'_> {
    fn substituted_name(&self, side: Side, node: usize) -> String {
        apply_substitutions(&name_of(side, node), self.substitutions).to_lowercase()
    }

    fn normalized(&self, side: Side, node: usize) -> String {
        collapse_digits(&self.substituted_name(side, node))
    }

    fn emit(&mut self, out: &mut Vec<SemanticPair>, left_node: usize, right_node: usize) {
        let name = name_score(
            self.left,
            left_node,
            self.right,
            right_node,
            self.substitutions,
        );
        let position = position_score(left_node, right_node, &self.left_index, &self.right_index);
        let substitution = substitution_score(
            self.left,
            left_node,
            self.right,
            right_node,
            self.substitutions,
        );
        let name_key =
            if self.normalized(self.left, left_node) == self.normalized(self.right, right_node) {
                1.0
            } else {
                name
            };
        out.push(SemanticPair {
            left: left_node,
            right: right_node,
            score: 0.55 + 0.3 * name_key + 0.1 * position + 0.05 * substitution,
            reasons: MatchReasons {
                children: 1.0,
                name: round(name),
                position: round(position),
                substitution: round(substitution),
            },
        });
    }

    /// Zips matching groups in bucket order; leftovers remain for the next key.
    fn pair_groups(&mut self, out: &mut Vec<SemanticPair>, normalized: bool) {
        let used_left: HashSet<usize> = out.iter().map(|pair| pair.left).collect();
        let used_right: HashSet<usize> = out.iter().map(|pair| pair.right).collect();
        let left_rest: Vec<usize> = self
            .lefts
            .iter()
            .copied()
            .filter(|node| !used_left.contains(node))
            .collect();
        let right_rest: Vec<usize> = self
            .rights
            .iter()
            .copied()
            .filter(|node| !used_right.contains(node))
            .collect();
        let key_of = |side: Side, node: usize| {
            if normalized {
                self.normalized(side, node)
            } else {
                self.substituted_name(side, node)
            }
        };
        let left_groups = group_by(&left_rest, |node| key_of(self.left, node));
        let right_groups = group_by(&right_rest, |node| key_of(self.right, node));
        for (key, left_group) in left_groups.iter() {
            let Some(right_group) = right_groups.get(key) else {
                continue;
            };
            let common = left_group.len().min(right_group.len());
            for at in 0..common {
                self.emit(out, left_group[at], right_group[at]);
            }
        }
    }

    fn run(mut self) -> Vec<SemanticPair> {
        let mut out = Vec::new();
        self.pair_groups(&mut out, false);
        self.pair_groups(&mut out, true);
        // Anything left is paired by ordinal position, but only when the names are
        // still plausibly related; identical children alone must not invent a pair.
        let (remaining_left, remaining_right) = remaining_pairs(self.lefts, self.rights, &out);
        let common = remaining_left.len().min(remaining_right.len());
        for at in 0..common {
            let left_node = remaining_left[at];
            let right_node = remaining_right[at];
            if name_score(
                self.left,
                left_node,
                self.right,
                right_node,
                self.substitutions,
            ) < 0.5
            {
                continue;
            }
            self.emit(&mut out, left_node, right_node);
        }
        out
    }
}

/// Cheap linear assignment for buckets above the pair limit.
fn assign_fallback(
    left: Side,
    lefts: &[usize],
    right: Side,
    rights: &[usize],
    substitutions: &Substitutions,
) -> Vec<SemanticPair> {
    let key_of = |side: Side, node: usize| {
        apply_substitutions(&name_of(side, node), substitutions).to_lowercase()
    };
    let left_groups = group_by(lefts, |node| key_of(left, node));
    let right_groups = group_by(rights, |node| key_of(right, node));
    let mut out = Vec::new();
    for (key, left_group) in left_groups.iter() {
        let Some(right_group) = right_groups.get(key) else {
            continue;
        };
        let count = left_group.len().min(right_group.len());
        for at in 0..count {
            out.push(SemanticPair {
                left: left_group[at],
                right: right_group[at],
                score: SEMANTIC_SCORE_FLOOR,
                reasons: MatchReasons {
                    children: 0.0,
                    name: 1.0,
                    position: 1.0,
                    substitution: 0.0,
                },
            });
        }
    }
    out
}

struct NamedScore {
    node: usize,
    score: f64,
}

fn substitution_token_sets(
    side: Side,
    nodes: &[usize],
    substitutions: &Substitutions,
) -> HashMap<usize, HashSet<String>> {
    nodes
        .iter()
        .map(|node| {
            let name = apply_substitutions(&name_of(side, *node), substitutions).to_lowercase();
            (*node, token_set(&name))
        })
        .collect()
}

fn build_token_postings(
    nodes: &[usize],
    tokens: &HashMap<usize, HashSet<String>>,
) -> HashMap<String, Vec<usize>> {
    let mut postings: HashMap<String, Vec<usize>> = HashMap::new();
    for node in nodes {
        let Some(set) = tokens.get(node) else {
            continue;
        };
        for token in set {
            postings.entry(token.clone()).or_default().push(*node);
        }
    }
    postings
}

fn token_set_of(tokens: &HashMap<usize, HashSet<String>>, node: usize) -> &HashSet<String> {
    tokens
        .get(&node)
        .expect("every scored node has a token set")
}

fn name_score(
    left: Side,
    left_node: usize,
    right: Side,
    right_node: usize,
    substitutions: &Substitutions,
) -> f64 {
    let left_name = apply_substitutions(&name_of(left, left_node), substitutions).to_lowercase();
    let right_name = apply_substitutions(&name_of(right, right_node), substitutions).to_lowercase();
    if left_name.is_empty() || right_name.is_empty() {
        return 0.0;
    }
    name_similarity(
        &left_name,
        &token_set(&left_name),
        &right_name,
        &token_set(&right_name),
    )
}

fn position_score(
    left_node: usize,
    right_node: usize,
    left_index: &HashMap<usize, usize>,
    right_index: &HashMap<usize, usize>,
) -> f64 {
    let i = left_index.get(&left_node).copied().unwrap_or(0) as f64;
    let j = right_index.get(&right_node).copied().unwrap_or(0) as f64;
    let span = left_index.len().max(right_index.len()).max(1) as f64;
    (1.0 - (i - j).abs() / span).clamp(0.0, 1.0)
}

fn remember_best(map: &mut HashMap<usize, NamedScore>, from: usize, to: usize, score: f64) {
    let better = match map.get(&from) {
        Some(current) => score > current.score,
        None => true,
    };
    if better {
        map.insert(from, NamedScore { node: to, score });
    }
}

fn note_name_candidate(
    candidates: &mut HashMap<usize, f64>,
    left_tokens: &HashSet<String>,
    right_tokens: &HashMap<usize, HashSet<String>>,
    right: usize,
) {
    if candidates.contains_key(&right) {
        return;
    }
    candidates.insert(
        right,
        token_jaccard(left_tokens, token_set_of(right_tokens, right)),
    );
}

fn token_candidate_scores(
    left_tokens: &HashSet<String>,
    right_tokens: &HashMap<usize, HashSet<String>>,
    postings: &HashMap<String, Vec<usize>>,
    frequency_limit: usize,
) -> HashMap<usize, f64> {
    let mut candidates: HashMap<usize, f64> = HashMap::new();
    for token in left_tokens {
        let Some(list) = postings.get(token) else {
            continue;
        };
        if list.len() > frequency_limit {
            continue;
        }
        for right in list {
            note_name_candidate(&mut candidates, left_tokens, right_tokens, *right);
        }
    }
    candidates
}

fn at_index(items: &[usize], at: isize) -> Option<usize> {
    if at >= 0 && (at as usize) < items.len() {
        Some(items[at as usize])
    } else {
        None
    }
}

fn fill_position_alternatives(
    candidates: &mut HashMap<usize, f64>,
    left_tokens: &HashSet<String>,
    left_at: usize,
    rights: &[usize],
    right_tokens: &HashMap<usize, HashSet<String>>,
) {
    if candidates.len() >= 2 {
        return;
    }
    for offset in [0isize, -1, 1] {
        if let Some(right) = at_index(rights, left_at as isize + offset) {
            note_name_candidate(candidates, left_tokens, right_tokens, right);
        }
    }
}

fn compare_named_candidates(a: &(usize, f64), b: &(usize, f64)) -> Ordering {
    b.1.partial_cmp(&a.1)
        .unwrap_or(Ordering::Equal)
        .then_with(|| a.0.cmp(&b.0))
}

fn remember_ranked_candidates(
    best_right: &mut HashMap<usize, NamedScore>,
    best_left: &mut HashMap<usize, NamedScore>,
    left: usize,
    candidates: &HashMap<usize, f64>,
) {
    let mut ranked: Vec<(usize, f64)> = candidates
        .iter()
        .map(|(node, score)| (*node, *score))
        .collect();
    ranked.sort_by(compare_named_candidates);
    ranked.truncate(16);
    for (right, score) in ranked {
        if score > 0.0 {
            remember_best(best_right, left, right, score);
            remember_best(best_left, right, left, score);
        }
    }
}

struct BestScores {
    best_left: HashMap<usize, NamedScore>,
    best_right: HashMap<usize, NamedScore>,
}

fn name_best_scores(
    lefts: &[usize],
    rights: &[usize],
    left_tokens: &HashMap<usize, HashSet<String>>,
    right_tokens: &HashMap<usize, HashSet<String>>,
    postings: &HashMap<String, Vec<usize>>,
) -> BestScores {
    let frequency_limit = 32.max((rights.len() as f64 * 0.1).ceil() as usize);
    let mut best_right: HashMap<usize, NamedScore> = HashMap::new();
    let mut best_left: HashMap<usize, NamedScore> = HashMap::new();
    for (left_at, left_node) in lefts.iter().enumerate() {
        let tokens = token_set_of(left_tokens, *left_node);
        let mut candidates =
            token_candidate_scores(tokens, right_tokens, postings, frequency_limit);
        fill_position_alternatives(&mut candidates, tokens, left_at, rights, right_tokens);
        remember_ranked_candidates(&mut best_right, &mut best_left, *left_node, &candidates);
    }
    BestScores {
        best_left,
        best_right,
    }
}

fn name_seeds(
    left: Side,
    lefts: &[usize],
    right: Side,
    best: &BestScores,
    substitutions: &Substitutions,
) -> Vec<SemanticPair> {
    let mut seeds = Vec::new();
    for left_node in lefts {
        let Some(picked) = best.best_right.get(left_node) else {
            continue;
        };
        let mutual = best.best_left.get(&picked.node).map(|found| found.node) == Some(*left_node);
        if !mutual {
            continue;
        }
        // Jaccard chooses the mutual-best pair; the full name score gates learning.
        let score = name_score(left, *left_node, right, picked.node, substitutions);
        if score >= SEMANTIC_NAME_SEED_FLOOR {
            seeds.push(SemanticPair {
                left: *left_node,
                right: picked.node,
                score,
                reasons: MatchReasons {
                    children: 0.0,
                    name: round(score),
                    position: 0.0,
                    substitution: 0.0,
                },
            });
        }
    }
    seeds
}

/// Learns token changes from mutual-best name pairs, before child values are scored.
fn learn_name_substitutions(
    left: Side,
    lefts: &[usize],
    right: Side,
    rights: &[usize],
    substitutions: &Substitutions,
) -> bool {
    let left_tokens = substitution_token_sets(left, lefts, substitutions);
    let right_tokens = substitution_token_sets(right, rights, substitutions);
    // Inverted index over the right side. A token shared by more than a tenth of
    // the bucket is a stop token; the unique ordinal token still gives a seed.
    let postings = build_token_postings(rights, &right_tokens);
    let best = name_best_scores(lefts, rights, &left_tokens, &right_tokens, &postings);
    let seeds = name_seeds(left, lefts, right, &best, substitutions);
    learn_substitutions(
        left,
        right,
        &seeds,
        substitutions,
        SEMANTIC_NAME_SEED_FLOOR,
        true,
    )
}

/// How often each token change appeared in the seeds.
#[derive(Default)]
struct SubstitutionTally {
    counts: Vec<(String, Vec<(String, u32)>)>,
    totals: Vec<(String, u32)>,
    /// True when this token came from a seed with exactly one usable token change.
    sole: Vec<(String, bool)>,
}

impl SubstitutionTally {
    fn total(&self, old: &str) -> u32 {
        self.totals
            .iter()
            .find(|(key, _)| key == old)
            .map(|(_, count)| *count)
            .unwrap_or(0)
    }

    fn total_mut(&mut self, old: &str) -> &mut u32 {
        if let Some(at) = self.totals.iter().position(|(key, _)| key == old) {
            return &mut self.totals[at].1;
        }
        self.totals.push((old.to_string(), 0));
        &mut self.totals.last_mut().expect("just pushed").1
    }

    fn by_next_mut(&mut self, old: &str) -> &mut Vec<(String, u32)> {
        if let Some(at) = self.counts.iter().position(|(key, _)| key == old) {
            return &mut self.counts[at].1;
        }
        self.counts.push((old.to_string(), Vec::new()));
        &mut self.counts.last_mut().expect("just pushed").1
    }

    fn sole(&self, old: &str) -> Option<bool> {
        self.sole
            .iter()
            .find(|(key, _)| key == old)
            .map(|(_, value)| *value)
    }

    fn set_sole(&mut self, old: &str, value: bool) {
        if let Some(at) = self.sole.iter().position(|(key, _)| key == old) {
            self.sole[at].1 = value;
            return;
        }
        self.sole.push((old.to_string(), value));
    }

    fn note_sole(&mut self, changes: &[(String, String)]) {
        if changes.len() == 1 && self.sole(&changes[0].0) != Some(false) {
            let old = changes[0].0.clone();
            self.set_sole(&old, true);
            return;
        }
        if changes.len() > 1 {
            for (old, _) in changes {
                self.set_sole(old, false);
            }
        }
    }

    fn record(&mut self, old: &str, next: &str) {
        *self.total_mut(old) += 1;
        let list = self.by_next_mut(old);
        match list.iter_mut().find(|(key, _)| key == next) {
            Some((_, count)) => *count += 1,
            None => list.push((next.to_string(), 1)),
        }
    }
}

fn tally_seed(
    tally: &mut SubstitutionTally,
    seed: &SemanticPair,
    left: Side,
    right: Side,
    min_score: f64,
) {
    if seed.score < min_score {
        return;
    }
    let left_name = name_of(left, seed.left);
    let right_name = name_of(right, seed.right);
    if left_name == right_name {
        return;
    }
    let changes = usable_token_changes(&left_name, &right_name);
    for (old, next) in &changes {
        tally.record(old, next);
    }
    tally.note_sole(&changes);
}

fn best_next_of(by_next: &[(String, u32)]) -> (String, u32) {
    let mut best_next = String::new();
    let mut best_count = 0;
    for (next, count) in by_next {
        if *count > best_count || (*count == best_count && *next < best_next) {
            best_next = next.clone();
            best_count = *count;
        }
    }
    (best_next, best_count)
}

fn substitution_candidates(
    tally: &SubstitutionTally,
    allow_single: bool,
) -> Vec<(String, String, u32)> {
    let mut out = Vec::new();
    for (old, by_next) in &tally.counts {
        let best = best_next_of(by_next);
        let total = tally.total(old);
        let consistent = best.1 >= 2 && best.1 as f64 / total.max(1) as f64 >= 0.6;
        let single = allow_single
            && best.1 == 1
            && total == 1
            && by_next.len() == 1
            && tally.sole(old) == Some(true);
        if consistent || single {
            out.push((old.clone(), best.0, best.1));
        }
    }
    out.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
    out
}

/// Learns `old→new` token changes from seed pairs and merges any new mappings.
/// Returns true when at least one mapping was added.
fn learn_substitutions(
    left: Side,
    right: Side,
    seeds: &[SemanticPair],
    substitutions: &Substitutions,
    min_score: f64,
    allow_single: bool,
) -> bool {
    let mut tally = SubstitutionTally::default();
    for seed in seeds {
        tally_seed(&mut tally, seed, left, right, min_score);
    }
    let candidates = substitution_candidates(&tally, allow_single);
    let mut added = false;
    for (old, next, _) in candidates {
        if !has_substitution(substitutions, &old) {
            learn_substitution(substitutions, &old, &next);
            added = true;
        }
    }
    added
}

// ---------------------------------------------------------------------------
// Candidate blocking
// ---------------------------------------------------------------------------

struct CandidateSink {
    out: Vec<(usize, usize)>,
    seen: HashSet<(usize, usize)>,
    per_left: HashMap<usize, usize>,
    limit_hit: bool,
}

impl CandidateSink {
    fn new() -> Self {
        Self {
            out: Vec::new(),
            seen: HashSet::new(),
            per_left: HashMap::new(),
            limit_hit: false,
        }
    }

    fn add(&mut self, left: usize, right: usize) {
        if self.limit_hit || self.out.len() >= SEMANTIC_MAX_TOTAL_CANDIDATES {
            self.limit_hit = true;
            return;
        }
        if self.count_for(left) >= SEMANTIC_MAX_CANDIDATES_PER_NODE {
            return;
        }
        if !self.seen.insert((left, right)) {
            return;
        }
        *self.per_left.entry(left).or_insert(0) += 1;
        self.out.push((left, right));
    }

    fn count_for(&self, left: usize) -> usize {
        self.per_left.get(&left).copied().unwrap_or(0)
    }
}

fn all_candidate_pairs(lefts: &[SemanticNode], rights: &[SemanticNode]) -> Vec<(usize, usize)> {
    let mut all = Vec::with_capacity(lefts.len() * rights.len());
    for left in lefts {
        for right in rights {
            all.push((left.index, right.index));
        }
    }
    all
}

fn add_group_candidates(
    sink: &mut CandidateSink,
    left_group: &[usize],
    right_group: &[usize],
    common: usize,
) {
    for at in 0..common {
        sink.add(left_group[at], right_group[at]);
    }
    // Unequal groups still get the nearest alternatives for the margin.
    for node in &left_group[common..] {
        sink.add(
            *node,
            right_group[common.min(right_group.len().saturating_sub(1))],
        );
    }
}

fn add_candidate_groups(
    sink: &mut CandidateSink,
    lefts: &[SemanticNode],
    rights: &[SemanticNode],
    key_of: &dyn Fn(&SemanticNode) -> String,
    skip_empty: bool,
) {
    let grouped = |nodes: &[SemanticNode]| {
        let mut groups = OrderedGroups::default();
        for node in nodes {
            let key = key_of(node);
            if skip_empty && key.is_empty() {
                continue;
            }
            groups.push(key, node.index);
        }
        groups
    };
    let left_groups = grouped(lefts);
    let right_groups = grouped(rights);
    for (key, left_group) in left_groups.iter() {
        let Some(right_group) = right_groups.get(key) else {
            continue;
        };
        let common = left_group.len().min(right_group.len());
        add_group_candidates(sink, left_group, right_group, common);
    }
}

fn note_candidate(seen: &mut HashSet<usize>, candidates: &mut Vec<usize>, right: usize) {
    if seen.insert(right) {
        candidates.push(right);
    }
}

// Rare tokens: digits usually give a cheap 1:1 ordinal seed. Suppress tokens
// common enough to produce the full product.
fn rare_token_candidates(
    left: &SemanticNode,
    rights: &[SemanticNode],
    postings: &HashMap<String, Vec<usize>>,
    frequency_limit: usize,
) -> Vec<usize> {
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();
    for token in &left.tokens {
        let Some(list) = postings.get(token) else {
            continue;
        };
        if list.len() > frequency_limit {
            continue;
        }
        for right in list {
            note_candidate(&mut seen, &mut candidates, *right);
        }
    }
    candidates.sort_by(|a, b| {
        let left_jaccard = token_jaccard(&left.tokens, &rights[*b].tokens);
        let right_jaccard = token_jaccard(&left.tokens, &rights[*a].tokens);
        left_jaccard
            .partial_cmp(&right_jaccard)
            .unwrap_or(Ordering::Equal)
            .then_with(|| a.cmp(b))
    });
    candidates.truncate(SEMANTIC_MAX_CANDIDATES_PER_NODE);
    candidates
}

fn add_token_candidates(sink: &mut CandidateSink, lefts: &[SemanticNode], rights: &[SemanticNode]) {
    let mut postings: HashMap<String, Vec<usize>> = HashMap::new();
    for right in rights {
        for token in &right.tokens {
            postings.entry(token.clone()).or_default().push(right.index);
        }
    }
    let frequency_limit = 32.max((rights.len() as f64 * 0.1).ceil() as usize);
    for left in lefts {
        for right in rare_token_candidates(left, rights, &postings, frequency_limit) {
            sink.add(left.index, right);
        }
    }
}

fn directions_at(offset: usize) -> &'static [isize] {
    if offset == 0 {
        &[0]
    } else {
        &[-1, 1]
    }
}

fn add_at_offset(
    sink: &mut CandidateSink,
    left_at: usize,
    rights: &[SemanticNode],
    direction: isize,
    offset: usize,
) {
    let at = left_at as isize + direction * offset as isize;
    if at >= 0 && (at as usize) < rights.len() {
        sink.add(left_at, rights[at as usize].index);
    }
}

fn add_position_neighbours(
    sink: &mut CandidateSink,
    lefts: &[SemanticNode],
    rights: &[SemanticNode],
) {
    // Every left needs at least a second candidate for the near-tie margin, even
    // when no signature/child/token candidate exists.
    for left in lefts {
        if sink.count_for(left.index) >= 2 {
            continue;
        }
        for offset in 0..=SEMANTIC_POSITION_NEIGHBOURS {
            for direction in directions_at(offset) {
                add_at_offset(sink, left.index, rights, *direction, offset);
            }
        }
    }
}

/// Candidate blocking for one bucket.
///
/// Small buckets keep the all-pairs behaviour. Large buckets get signature groups
/// (the bulk-rename path), non-empty child-key groups, rare tokens and a few
/// position neighbours. Neighbours are deliberate: the near-tie margin needs a
/// second score, so a single candidate must not look certain.
fn collect_semantic_candidates(
    lefts: &[SemanticNode],
    rights: &[SemanticNode],
    context: &mut Context,
) -> Vec<(usize, usize)> {
    if lefts.len() * rights.len() <= SEMANTIC_FULL_SCORE_PRODUCT {
        return all_candidate_pairs(lefts, rights);
    }
    let mut sink = CandidateSink::new();
    add_candidate_groups(
        &mut sink,
        lefts,
        rights,
        &|node| node.signature.clone(),
        false,
    );
    add_candidate_groups(
        &mut sink,
        lefts,
        rights,
        &|node| node.child_key_signature.clone(),
        true,
    );
    add_token_candidates(&mut sink, lefts, rights);
    add_position_neighbours(&mut sink, lefts, rights);
    if sink.limit_hit {
        context.semantic_budget_hit = true;
    }
    sink.out
}

// ---------------------------------------------------------------------------
// The merged tree
// ---------------------------------------------------------------------------

struct MergedNode {
    key: String,
    kind: String,
    status: DiffStatus,
    left: Option<DiffCell>,
    right: Option<DiffCell>,
    changes: Vec<DiffChange>,
    match_: Option<DiffMatch>,
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
        ("variant".into(), variant_text(left), variant_text(right)),
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

/// Marks a changed field that differs only by the learned substitution.
fn mark_rename_implied(changes: &mut [DiffChange], substitutions: &Substitutions) {
    if substitution_count(substitutions) == 0 {
        return;
    }
    for change in changes {
        if apply_substitutions(&change.left, substitutions) == change.right {
            change.rename_implied = Some(true);
        }
    }
}

fn paired_node(
    left: Side,
    left_node: usize,
    right: Side,
    right_node: usize,
    ranges: Ranges,
    found: Option<DiffMatch>,
    context: &mut Context,
) -> MergedNode {
    let left_row = left.row(left_node);
    let right_row = right.row(right_node);
    let left_cell = cell_of(left_row, (ranges.left)(&left_row.id));
    let right_cell = cell_of(right_row, (ranges.right)(&right_row.id));
    let mut changes = diff_changes(&left_cell, &right_cell);
    mark_rename_implied(&mut changes, &context.substitutions);
    let relative = found
        .as_ref()
        .map(|found| found.kind == "semantic")
        .unwrap_or(false);
    let mut child_context = Context::child(context, relative);
    let child_of = if relative {
        &mut child_context
    } else {
        context
    };
    let children = merge_children(
        left,
        left.children(left_node),
        right,
        right.children(right_node),
        ranges,
        child_of,
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
        match_: found,
        children,
    }
}

fn side_node(side: Side, node: usize, status: DiffStatus, range: RangeLookup) -> MergedNode {
    let row = side.row(node);
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
        match_: None,
        children: side
            .children(node)
            .iter()
            .map(|child| side_node(side, *child, status, range))
            .collect(),
    }
}

/// Right-only rows queue behind the nearest earlier right sibling that paired
/// with a left row; the empty key is "before the first left child".
fn right_only_by_previous(left: Side, rights: &[usize], pairing: &Pairing) -> OrderedGroups {
    let mut groups = OrderedGroups::default();
    let mut previous = String::new();
    for right in rights {
        if let Some(left_node) = pairing.match_of_right.get(right) {
            previous = left.row(*left_node).id.clone();
            continue;
        }
        groups.push(previous.clone(), *right);
    }
    groups
}

fn push_side(
    out: &mut Vec<MergedNode>,
    side: Side,
    nodes: Option<&Vec<usize>>,
    status: DiffStatus,
    range: RangeLookup,
) {
    if let Some(nodes) = nodes {
        for node in nodes {
            out.push(side_node(side, *node, status, range));
        }
    }
}

fn merge_children(
    left: Side,
    lefts: &[usize],
    right: Side,
    rights: &[usize],
    ranges: Ranges,
    context: &mut Context,
) -> Vec<MergedNode> {
    let pairing = pair_level(left, lefts, right, rights, context);
    let mut match_of_left: HashMap<usize, usize> = HashMap::new();
    for (right_node, left_node) in &pairing.match_of_right {
        match_of_left.insert(*left_node, *right_node);
    }
    let right_only = right_only_by_previous(left, rights, &pairing);
    let mut out = Vec::new();
    push_side(
        &mut out,
        right,
        right_only.get(""),
        DiffStatus::Added,
        ranges.right,
    );
    for left_node in lefts {
        match match_of_left.get(left_node) {
            Some(right_node) => out.push(paired_node(
                left,
                *left_node,
                right,
                *right_node,
                ranges,
                pairing.matches.get(left_node).cloned(),
                context,
            )),
            None => out.push(side_node(
                left,
                *left_node,
                DiffStatus::Removed,
                ranges.left,
            )),
        }
        let left_id = &left.row(*left_node).id;
        push_side(
            &mut out,
            right,
            right_only.get(left_id),
            DiffStatus::Added,
            ranges.right,
        );
    }
    out
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

fn haystack_of_opt(cell: Option<&DiffCell>) -> String {
    cell.map(haystack_of).unwrap_or_default()
}

/// Pre-order flatten with level, parent, hasChildren and subtreeSize recomputed.
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
        match_: node.match_.clone(),
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
    let children = node.children.len() as u32;
    for (index, child) in node.children.iter().enumerate() {
        flatten(
            child,
            Some(&node.key),
            level + 1,
            index as u32 + 1,
            children,
            out,
        );
    }
    out[at].subtree_size = (out.len() - at - 1) as u32;
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
        if row.match_.as_ref().map(|found| found.kind.as_str()) == Some("semantic") {
            summary.renamed += 1;
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

/// Builds the diff document for two row sets.
pub fn build_diff_document(
    left: DiffSide<'_>,
    right: DiffSide<'_>,
    options: &DiffOptions,
) -> DiffDocument {
    let left_tree = tree_of(left.rows);
    let right_tree = tree_of(right.rows);
    let left_side = Side::new(&left_tree, left.rows);
    let right_side = Side::new(&right_tree, right.rows);
    let mut context = Context::new(
        options.semantic_matching,
        options
            .semantic_pair_budget
            .unwrap_or(SEMANTIC_SCORE_BUDGET),
    );
    let merged = merge_children(
        left_side,
        &left_tree.roots,
        right_side,
        &right_tree.roots,
        Ranges {
            left: left.range,
            right: right.range,
        },
        &mut context,
    );
    let mut rows = Vec::new();
    let count = merged.len() as u32;
    for (index, node) in merged.iter().enumerate() {
        flatten(node, None, 1, index as u32 + 1, count, &mut rows);
    }
    DiffDocument {
        labels: labels_for(&left.label, &right.label),
        left: left.label,
        right: right.label,
        left_header: left.header,
        right_header: right.header,
        summary: summarize(&rows),
        rows,
        semantic_skipped: context.semantic_skipped,
        semantic_limit_reason: context.semantic_limit_reason,
    }
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
        diff_with(left_text, right_text, false)
    }

    fn diff_with(left_text: &str, right_text: &str, semantic: bool) -> DiffDocument {
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
                semantic_matching: semantic,
                semantic_pair_budget: None,
            },
        )
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

    #[test]
    fn strict_mode_reports_no_semantic_match() {
        let document = diff_text(DOC, DOC);
        assert!(document.rows.iter().all(|row| row.match_.is_none()));
        assert_eq!(document.summary.renamed, 0);
    }

    fn renamed_pair(prefix: &str) -> String {
        let containers: String = (1..=2)
            .map(|at| {
                format!(
                    r#"<ECUC-CONTAINER-VALUE>
  <SHORT-NAME>{prefix}_MO_0{at}_MAIN_BUS</SHORT-NAME>
  <DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/D/MainBus</DEFINITION-REF>
  <PARAMETER-VALUES>
    <ECUC-NUMERICAL-PARAM-VALUE>
      <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/A</DEFINITION-REF>
      <VALUE>{at}</VALUE>
    </ECUC-NUMERICAL-PARAM-VALUE>
  </PARAMETER-VALUES>
</ECUC-CONTAINER-VALUE>
"#
                )
            })
            .collect();
        DOC.replace(
            r#"            <ECUC-CONTAINER-VALUE>
              <SHORT-NAME>Cont</SHORT-NAME>
              <DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Pkg/Mod/Cont</DEFINITION-REF>
              <PARAMETER-VALUES>
                <ECUC-NUMERICAL-PARAM-VALUE>
                  <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/Mod/Cont/P</DEFINITION-REF>
                  <VALUE>1</VALUE>
                </ECUC-NUMERICAL-PARAM-VALUE>
              </PARAMETER-VALUES>
            </ECUC-CONTAINER-VALUE>
"#,
            &containers,
        )
    }

    #[test]
    fn semantic_mode_learns_the_rename_into_the_change() {
        let document = diff_with(&renamed_pair("NMH"), &renamed_pair("NM"), true);
        let renamed: Vec<&DiffRow> = document
            .rows
            .iter()
            .filter(|row| row.match_.as_ref().map(|found| found.kind.as_str()) == Some("semantic"))
            .collect();
        assert_eq!(renamed.len(), 2);
        assert_eq!(document.summary.added, 0);
        assert_eq!(document.summary.removed, 0);
        let short_name = renamed[0]
            .changes
            .iter()
            .find(|change| change.field == "short name")
            .expect("the rename is reported as a short-name change");
        assert_eq!(short_name.rename_implied, Some(true));
        let substitutions = renamed[0]
            .match_
            .as_ref()
            .and_then(|found| found.substitutions.clone());
        assert_eq!(substitutions, Some(vec!["NMH\u{2192}NM".to_string()]));
    }

    #[test]
    fn a_tiny_budget_stops_scoring_and_says_why() {
        let left = Document::new(renamed_pair("NMH"));
        let right = Document::new(renamed_pair("NM"));
        let left_lookup = |id: &str| left.index().get(id).map(|entry| entry.range);
        let right_lookup = |id: &str| right.index().get(id).map(|entry| entry.range);
        let document = build_diff_document(
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
                semantic_matching: true,
                semantic_pair_budget: Some(1),
            },
        );
        assert!(
            document.semantic_skipped > 0,
            "the slice leaves pairs unscored"
        );
        assert_eq!(document.semantic_limit_reason.as_deref(), Some("budget"));
    }

    #[test]
    fn semantic_mode_pairs_a_renamed_container() {
        let right_text = DOC.replace(
            "<SHORT-NAME>Cont</SHORT-NAME>",
            "<SHORT-NAME>Cont2</SHORT-NAME>",
        );
        let document = diff_with(DOC, &right_text, true);
        let container = document
            .rows
            .iter()
            .find(|row| row.kind == "container")
            .expect("the container row");
        assert_eq!(container.status, DiffStatus::Changed);
        let found = container.match_.as_ref().expect("semantic match");
        assert_eq!(found.kind, "semantic");
        assert!(found.score > 0.6, "score {}", found.score);
        assert_eq!(found.reasons.children, 1.0);
        assert_eq!(document.summary.renamed, 1);
        assert_eq!(document.summary.added, 0);
        assert_eq!(document.summary.removed, 0);
    }
}
