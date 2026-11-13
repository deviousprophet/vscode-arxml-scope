//! The ARXML/ECUC domain engine: parse, ids, rows, conditions and edit planning.
//!
//! No Node, N-API or VS Code dependency: the process wrapper in `arxml-engine` owns
//! I/O, and this crate owns every ECUC decision.

pub mod edit;
pub mod model;
pub mod node_id;
pub mod order;
pub mod rows;
pub mod scanner;
pub mod syscond;
pub mod text;
pub mod validate;

pub use model::{EcucDocumentModel, Range, SortMode};
pub use node_id::{build_node_index, NodeIndex};
pub use rows::{build_rows, Row, RowOptions};
pub use scanner::scan_ecuc_values;
pub use text::SourceText;

/// One open document: the retained text, its model, the id index and the last rows.
pub struct Document {
    text: SourceText,
    model: EcucDocumentModel,
    index: NodeIndex,
    options: RowOptions,
    rows: Vec<Row>,
}

impl Document {
    pub fn new(text: String) -> Self {
        let mut document = Self {
            text: SourceText::new(text),
            model: EcucDocumentModel::default(),
            index: NodeIndex::default(),
            options: RowOptions::default(),
            rows: Vec::new(),
        };
        document.rescan();
        document
    }

    fn rescan(&mut self) {
        self.model = scanner::scan_ecuc_values(self.text.as_str().to_string());
        self.index = build_node_index(&self.model);
        self.rows = build_rows(&self.model, &self.options);
    }

    pub fn text_len(&self) -> usize {
        self.text.len_utf16()
    }

    pub fn text(&self) -> &SourceText {
        &self.text
    }

    pub fn model(&self) -> &EcucDocumentModel {
        &self.model
    }

    pub fn index(&self) -> &NodeIndex {
        &self.index
    }

    pub fn nodes(&self) -> usize {
        self.index.len()
    }

    pub fn is_ecuc(&self) -> bool {
        !self.model.modules.is_empty()
    }

    pub fn counts(&self) -> (usize, usize, usize) {
        let mut containers = 0usize;
        let mut parameters = 0usize;
        let mut stack: Vec<&model::ContainerNode> = self
            .model
            .modules
            .iter()
            .flat_map(|m| m.containers.iter())
            .collect();
        while let Some(container) = stack.pop() {
            containers += 1;
            parameters += container.parameters.len();
            stack.extend(container.containers.iter());
        }
        (self.model.modules.len(), containers, parameters)
    }

    /// Sets the rows' options and rebuilds the cached row store.
    pub fn set_options(&mut self, options: RowOptions) {
        self.options = options;
        self.rows = build_rows(&self.model, &self.options);
    }

    pub fn rows(&self) -> &[Row] {
        &self.rows
    }

    /// Applies one text change, rescans, and returns the row replacement it caused.
    pub fn apply_change(&mut self, start: usize, end: usize, new_text: &str) -> Patch {
        self.apply_changes(&[(start, end, new_text.to_string())])
    }

    /// Applies a batch of changes (already ordered descending by start), rescans once.
    pub fn apply_changes(&mut self, changes: &[(usize, usize, String)]) -> Patch {
        let mut text = self.text.as_str().to_string();
        for (start, end, new_text) in changes {
            let start_byte = self.text.byte_at_utf16(*start);
            let end_byte = self.text.byte_at_utf16(*end);
            // Offsets are relative to the document the batch was recorded against, so
            // each splice is computed from the original text for that change.
            let mut next = String::with_capacity(text.len() + new_text.len());
            next.push_str(&text[..start_byte]);
            next.push_str(new_text);
            next.push_str(&text[end_byte.min(text.len())..]);
            text = next;
        }
        self.text = SourceText::new(text);
        let previous = std::mem::take(&mut self.rows);
        self.rescan();
        diff_rows(&previous, &self.rows)
    }

    /// Replaces the whole text (recovery path).
    pub fn resync(&mut self, text: String) {
        self.text = SourceText::new(text);
        self.rescan();
    }
}

/// One contiguous replacement in display order.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Patch {
    pub at: usize,
    pub remove: usize,
    pub rows: Vec<Row>,
}

/// The prefix/suffix comparison that turns two row stores into one replacement.
fn diff_rows(previous: &[Row], next: &[Row]) -> Patch {
    let common = previous.len().min(next.len());
    let mut prefix = 0;
    while prefix < common && same_identity(&previous[prefix], &next[prefix]) {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < common - prefix
        && same_identity(
            &previous[previous.len() - 1 - suffix],
            &next[next.len() - 1 - suffix],
        )
    {
        suffix += 1;
    }
    let remove = previous.len() - prefix - suffix;
    let inserted: Vec<Row> = next[prefix..next.len() - suffix].to_vec();
    Patch {
        at: prefix,
        remove,
        rows: inserted,
    }
}

fn same_identity(left: &Row, right: &Row) -> bool {
    left.id == right.id
        && left.label == right.label
        && left.value == right.value
        && left.target == right.target
        && left.subtree_size == right.subtree_size
        && left.has_children == right.has_children
        && left.disabled == right.disabled
}
