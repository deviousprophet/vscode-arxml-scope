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

#[cfg(test)]
mod tests {
    use super::*;

    const DOC: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://autosar.org/schema/r4.0 AUTOSAR_00048.xsd">
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

    #[test]
    fn scans_a_minimal_document() {
        let model = scan_ecuc_values(DOC.to_string());
        assert_eq!(
            model.schema.as_ref().map(|schema| schema.release.as_str()),
            Some("00048")
        );
        assert_eq!(model.modules.len(), 1);
        assert_eq!(model.modules[0].short_name, "Mod");
        assert_eq!(model.modules[0].containers.len(), 1);
        let container = &model.modules[0].containers[0];
        assert_eq!(container.container_path, vec!["Pkg", "Mod"]);
        assert_eq!(container.parameters.len(), 1);
        let parameter = &container.parameters[0];
        assert_eq!(parameter.name, "P");
        assert_eq!(parameter.display_value.as_deref(), Some("1"));
        assert!(parameter.numeric);
        assert!(parameter.value_range.is_some());
    }

    #[test]
    fn builds_path_ids_and_rows() {
        let document = Document::new(DOC.to_string());
        let rows = document.rows();
        assert_eq!(rows.len(), 3, "module, container and parameter");
        assert_eq!(rows[0].id, "module:/Pkg/Mod|Mod#0");
        assert_eq!(rows[1].id, "container:Pkg/Mod/Cont#0");
        assert_eq!(rows[2].id, "container:Pkg/Mod/Cont#0/param:P#0");
        assert_eq!(rows[2].value.as_deref(), Some("1"));
        assert_eq!(rows[2].shown_value.as_deref(), Some("1"));
        assert_eq!(rows[2].parameter_type.as_deref(), Some("Integer"));
        assert_eq!(rows[2].subtree_size, 0);
        assert_eq!(rows[0].subtree_size, 2);
    }

    #[test]
    fn plans_a_value_edit_and_refuses_the_same_value() {
        let document = Document::new(DOC.to_string());
        let rows = document.rows();
        let parameter_id = rows[2].id.clone();
        let plan = edit::plan_value_edit(
            document.model(),
            document.index(),
            document.text(),
            &parameter_id,
            "2",
        );
        assert!(plan.ok, "{:?}", plan.reason);
        assert_eq!(plan.record.as_ref().unwrap().old_text, "1");
        let unchanged = edit::plan_value_edit(
            document.model(),
            document.index(),
            document.text(),
            &parameter_id,
            "1",
        );
        assert!(!unchanged.ok);
        assert_eq!(unchanged.reason.as_deref(), Some("the value is unchanged"));
    }

    #[test]
    fn wraps_a_self_closing_element_without_keeping_the_slash() {
        assert_eq!(edit::wrap_element("<VALUE/>", "x"), "<VALUE>x</VALUE>");
        assert_eq!(edit::wrap_element("<VALUE />", "x"), "<VALUE>x</VALUE>");
        assert_eq!(
            edit::wrap_element("<VALUE a=\"1\">", "x"),
            "<VALUE a=\"1\">x</VALUE>"
        );
    }

    #[test]
    fn applies_a_change_and_returns_a_one_row_patch() {
        let mut document = Document::new(DOC.to_string());
        let before = document.rows()[2].clone();
        let start = document.text().len_utf16();
        let _ = start;
        let text = document.text().as_str();
        let value_at = text.find("<VALUE>1</VALUE>").expect("value element") + 7;
        let patch = document.apply_change(value_at, value_at + 1, "7");
        assert_eq!(patch.remove, 1);
        assert_eq!(patch.rows.len(), 1);
        assert_eq!(patch.rows[0].id, before.id);
        assert_eq!(patch.rows[0].value.as_deref(), Some("7"));
    }
}
