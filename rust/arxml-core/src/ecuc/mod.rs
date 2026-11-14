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
        Self::with_options(text, RowOptions::default())
    }

    /// Opens one document with the row options the host is displaying.
    pub fn with_options(text: String, options: RowOptions) -> Self {
        let mut document = Self {
            text: SourceText::new(text),
            model: EcucDocumentModel::default(),
            index: NodeIndex::default(),
            options,
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

    /// Applies a batch of changes (already ordered descending by start).
    ///
    /// One change inside a `<VALUE>` text — the editor's only value edit — takes the
    /// in-place path: splice, shift the ranges after it, rewrite that one row. Nothing
    /// else is re-parsed, so a 20 MiB document costs a few milliseconds.
    pub fn apply_changes(&mut self, changes: &[(usize, usize, String)]) -> Patch {
        if let [change] = changes {
            if let Some(patch) = self.apply_value_edit(change.0, change.1, &change.2) {
                return patch;
            }
        }
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

    fn apply_value_edit(&mut self, start: usize, end: usize, new_text: &str) -> Option<Patch> {
        let (range, node_id, definition_dest, numeric) = self.value_target(start, end)?;
        let delta = text::utf16_len(new_text) as i32 - (end - start) as i32;
        let start_byte = self.text.byte_at_utf16(start);
        let end_byte = self.text.byte_at_utf16(end);
        let mut text = String::with_capacity(self.text.as_str().len() + new_text.len());
        text.push_str(&self.text.as_str()[..start_byte]);
        text.push_str(new_text);
        text.push_str(&self.text.as_str()[end_byte..]);
        self.text = SourceText::new(text);
        self.model.shift(end as u32, delta);
        self.index.shift(end as u32, delta);
        let position = self.rows.iter().position(|row| row.id == node_id)?;
        let value_end = (range.end as i64 + delta as i64) as usize;
        let value = text::decode_xml(self.text.slice_utf16(range.start as usize, value_end))
            .trim()
            .to_string();
        self.set_display_value(&node_id, &value);
        rows::refresh_value_row(
            &mut self.rows[position],
            definition_dest.as_deref(),
            numeric,
            &value,
        );
        Some(Patch {
            at: position,
            remove: 1,
            rows: vec![self.rows[position].clone()],
            structural: false,
        })
    }

    /// The value range, node id, DEST and numeric flag for a change inside a value text.
    fn value_target(
        &self,
        start: usize,
        end: usize,
    ) -> Option<(Range, String, Option<String>, bool)> {
        let covered = |range: &Option<Range>| match range {
            Some(range) => start >= range.start as usize && end <= range.end as usize,
            None => false,
        };
        for module in &self.model.modules {
            if let Some(found) = find_value(&module.containers, &covered, &self.index) {
                return Some(found);
            }
        }
        None
    }

    fn set_display_value(&mut self, node_id: &str, value: &str) {
        let Some(range) = self.index.get(node_id).map(|entry| entry.range) else {
            return;
        };
        set_value_in(&mut self.model.modules, range, value);
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
    /// True when rows shifted; a false patch can be applied in place by the page.
    pub structural: bool,
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
        structural: true,
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

fn find_value(
    containers: &[model::ContainerNode],
    covered: &impl Fn(&Option<Range>) -> bool,
    index: &NodeIndex,
) -> Option<(Range, String, Option<String>, bool)> {
    for container in containers {
        for parameter in &container.parameters {
            if !covered(&parameter.value_range) {
                continue;
            }
            if let (Some(value_range), Some(id)) =
                (parameter.value_range, index.id_of(parameter.range))
            {
                return Some((
                    value_range,
                    id.to_string(),
                    parameter.definition_dest.clone(),
                    parameter.numeric,
                ));
            }
        }
        if let Some(found) = find_value(&container.containers, covered, index) {
            return Some(found);
        }
    }
    None
}

fn set_value_in(modules: &mut [model::ModuleNode], range: Range, value: &str) -> bool {
    modules
        .iter_mut()
        .any(|module| set_value_in_containers(&mut module.containers, range, value))
}

fn set_value_in_containers(
    containers: &mut [model::ContainerNode],
    range: Range,
    value: &str,
) -> bool {
    for container in containers.iter_mut() {
        for parameter in container.parameters.iter_mut() {
            if parameter.range == range {
                parameter.display_value = Some(value.to_string());
                return true;
            }
        }
        if set_value_in_containers(&mut container.containers, range, value) {
            return true;
        }
    }
    false
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
    fn applies_a_value_edit_in_place_and_shifts_the_ranges_after_it() {
        let mut document = Document::new(DOC.to_string());
        let before = document.rows()[2].clone();
        let value_at = document
            .text()
            .as_str()
            .find("<VALUE>1</VALUE>")
            .expect("value element")
            + 7;
        let patch = document.apply_change(value_at, value_at + 1, "42");
        assert!(!patch.structural, "a value edit does not move rows");
        assert_eq!(patch.remove, 1);
        assert_eq!(patch.rows.len(), 1);
        assert_eq!(patch.rows[0].id, before.id);
        assert_eq!(patch.rows[0].value.as_deref(), Some("42"));
        assert_eq!(patch.rows[0].shown_value.as_deref(), Some("42"));
        assert_eq!(document.rows()[2].value.as_deref(), Some("42"));

        // The model and the id index moved with the text: a second edit plans and
        // applies against the shifted ranges.
        let plan = edit::plan_value_edit(
            document.model(),
            document.index(),
            document.text(),
            &before.id,
            "7",
        );
        assert!(plan.ok, "{:?}", plan.reason);
        let at = document
            .text()
            .as_str()
            .find("<VALUE>42</VALUE>")
            .expect("shifted value")
            + 7;
        let second = document.apply_change(at, at + 2, "7");
        assert_eq!(second.rows[0].value.as_deref(), Some("7"));
    }

    #[test]
    fn a_change_outside_a_value_takes_the_full_path() {
        let mut document = Document::new(DOC.to_string());
        let patch = document.apply_change(0, 0, " ");
        assert!(patch.structural, "a structural edit reports itself");
    }
}
