//! The copy patch: the rows one edit changed, derived from two diff documents.
//!
//! A copy edits one document; the panel should receive the rows that changed, not the
//! whole document again. Given the document before and after the edit and the edit
//! itself, this module returns the changed subtree block, the ancestor rows whose
//! display spans or ranges moved, and the offset shift that applies to every later
//! row, or a reason a rebuild is required.
//!
//! Ranges are absolute UTF-16 offsets, so an edit shifts the ranges of every node
//! after it in the edited file. That is why the patch carries `shift` and not just a
//! row span: without it, `patched == rebuild` fails on ranges alone.
//!
//! The invariant the tests pin: `apply_patch(before, patch_between(before, after,
//! edit)) == after`, rows and summary alike.

use serde::Serialize;

use super::{DiffDocument, DiffRow, DiffSummary};

/// Which document the edit changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PatchSide {
    Left,
    Right,
}

/// The text change the host applied, in UTF-16 offsets, plus its length delta.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AppliedEdit {
    pub side: PatchSide,
    pub start: u32,
    pub end: u32,
    /// `new_text.len()` minus the replaced span, in UTF-16 code units.
    pub by: i64,
}

impl AppliedEdit {
    pub fn is_insertion(&self) -> bool {
        self.start == self.end
    }
}

/// One ancestor row whose content changed: its range end, its display span, or both.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffAncestor {
    pub key: String,
    pub subtree_size: u32,
}

/// Offsets after `after` move by `by` on the edited side.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeShift {
    pub side: PatchSide,
    pub after: u32,
    pub by: i64,
}

/// A row replacement plus everything it cannot carry with it.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffPatch {
    /// First replaced row in the display list.
    pub at: usize,
    /// How many rows the replacement removes.
    pub remove: usize,
    /// The replacement rows, in display order.
    pub rows: Vec<DiffRow>,
    /// Ancestors above the replaced span, deepest last; full rows.
    pub ancestors: Vec<DiffRow>,
    /// The offset shift for rows after the edit.
    pub shift: Option<RangeShift>,
    /// The counters the new document reports.
    pub summary: DiffSummary,
    pub semantic_skipped: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PatchOutcome {
    Patch(DiffPatch),
    /// A rebuild is required; the reason is a stable code for the host's notice.
    Unpatchable(&'static str),
}

fn cell_range(row: &DiffRow, side: PatchSide) -> Option<(u32, u32)> {
    let cell = match side {
        PatchSide::Left => row.left.as_ref(),
        PatchSide::Right => row.right.as_ref(),
    };
    cell.map(|cell| (cell.range.start, cell.range.end))
}

fn contains(row: &DiffRow, side: PatchSide, offset: u32) -> bool {
    matches!(cell_range(row, side), Some((start, end)) if start <= offset && offset < end)
}

/// The deepest row whose element contains `offset`: rows are pre-order, so the last
/// containing row is the innermost one.
fn innermost(rows: &[DiffRow], side: PatchSide, offset: u32) -> Option<usize> {
    rows.iter().rposition(|row| contains(row, side, offset))
}

fn index_by_key(rows: &[DiffRow]) -> std::collections::HashMap<&str, usize> {
    rows.iter()
        .enumerate()
        .map(|(at, row)| (row.key.as_str(), at))
        .collect()
}

fn top_level_keys(rows: &[DiffRow]) -> Vec<&str> {
    rows.iter()
        .filter(|row| row.level == 1)
        .map(|row| row.key.as_str())
        .collect()
}

/// The contiguous child block of `parent`, descendants included (the root block when
/// `parent` is `None`). A parent's children are not adjacent rows: each child's whole
/// subtree sits between it and the next child.
fn child_block(rows: &[DiffRow], parent: Option<&str>) -> Option<(usize, usize)> {
    let start = rows.iter().position(|row| match parent {
        Some(key) => row.parent_key.as_deref() == Some(key),
        None => row.level == 1,
    })?;
    let level = rows[start].level;
    let end = rows[start..]
        .iter()
        .position(|row| row.level < level)
        .map(|offset| start + offset)
        .unwrap_or(rows.len());
    Some((start, end))
}

/// The first row whose whole element sits inside the replaced span: the copied or
/// replaced element itself, as opposed to one of its descendants.
fn contained_element(rows: &[DiffRow], side: PatchSide, start: u32, end: u32) -> Option<usize> {
    rows.iter().position(|row| {
        matches!(cell_range(row, side), Some((row_start, row_end)) if row_start >= start && row_end <= end)
    })
}

fn same_row(left: &DiffRow, right: &DiffRow) -> bool {
    left == right
}

/// The difference between two documents, as a patch the page can splice.
pub fn patch_between(
    previous: &DiffDocument,
    next: &DiffDocument,
    edit: AppliedEdit,
) -> PatchOutcome {
    if top_level_keys(&previous.rows) != top_level_keys(&next.rows) {
        return PatchOutcome::Unpatchable("top-level-order");
    }
    let old = &previous.rows;
    let new = &next.rows;
    let containing = contained_element(old, edit.side, edit.start, edit.end)
        .or_else(|| innermost(old, edit.side, edit.start));
    let Some(containing) = containing else {
        return PatchOutcome::Unpatchable("outside-elements");
    };
    // An insertion lands between a parent's children; a replacement lands on the
    // element being replaced, so its parent owns the sibling block.
    let parent_key = if edit.is_insertion() {
        old[containing].key.clone()
    } else {
        if old[containing].level == 1 {
            return PatchOutcome::Unpatchable("module-row");
        }
        match old[containing].parent_key.clone() {
            Some(key) => key,
            None => return PatchOutcome::Unpatchable("module-row"),
        }
    };
    let (Some((old_start, old_end)), Some((new_start, new_end))) = (
        child_block(old, Some(&parent_key)),
        child_block(new, Some(&parent_key)),
    ) else {
        return PatchOutcome::Unpatchable("parent-created");
    };
    // Ancestors above the parent block: their own spans and ranges moved with the edit.
    let old_index = index_by_key(old);
    let new_index = index_by_key(new);
    let mut ancestors = Vec::new();
    let mut cursor = Some(parent_key.as_str());
    while let Some(key) = cursor {
        let (Some(old_at), Some(new_at)) = (old_index.get(key), new_index.get(key)) else {
            return PatchOutcome::Unpatchable("ancestor-changed");
        };
        if !same_row(&old[*old_at], &new[*new_at]) {
            ancestors.push(new[*new_at].clone());
        }
        cursor = new[*new_at].parent_key.as_deref();
    }
    ancestors.reverse();
    let rows: Vec<DiffRow> = new[new_start..new_end].to_vec();
    let shift = if edit.by == 0 {
        None
    } else {
        Some(RangeShift {
            side: edit.side,
            after: edit.start,
            by: edit.by,
        })
    };
    PatchOutcome::Patch(DiffPatch {
        at: old_start,
        remove: old_end - old_start,
        rows,
        ancestors,
        shift,
        summary: next.summary.clone(),
        semantic_skipped: next.semantic_skipped,
    })
}

/// Applies a patch to the document it was derived from.
pub fn apply_patch(document: &DiffDocument, patch: &DiffPatch) -> DiffDocument {
    let mut patched = document.clone();
    let end = (patch.at + patch.remove).min(patched.rows.len());
    patched
        .rows
        .splice(patch.at..end, patch.rows.iter().cloned());
    for ancestor in &patch.ancestors {
        if let Some(row) = patched.rows.iter_mut().find(|row| row.key == ancestor.key) {
            *row = ancestor.clone();
        }
    }
    if let Some(shift) = patch.shift {
        let replaced = patch.at..patch.at + patch.rows.len();
        for (at, row) in patched.rows.iter_mut().enumerate() {
            // The replacement rows already carry their new ranges.
            if replaced.contains(&at) {
                continue;
            }
            let cell = match shift.side {
                PatchSide::Left => row.left.as_mut(),
                PatchSide::Right => row.right.as_mut(),
            };
            let Some(cell) = cell else { continue };
            if cell.range.start < shift.after {
                continue;
            }
            cell.range.start = (cell.range.start as i64 + shift.by).max(0) as u32;
            cell.range.end = (cell.range.end as i64 + shift.by).max(0) as u32;
        }
    }
    patched.summary = patch.summary.clone();
    patched.semantic_skipped = patch.semantic_skipped;
    patched
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diff::{build_diff_document, DiffHeader, DiffOptions, DiffSide, FileLabel};
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
                <ECUC-NUMERICAL-PARAM-VALUE>
                  <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/Mod/Cont/Q</DEFINITION-REF>
                  <VALUE>2</VALUE>
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

    fn document(text: &str) -> DiffDocument {
        let left = Document::new(text.to_string());
        let right = Document::new(text.to_string());
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
            &DiffOptions::default(),
        )
    }

    /// Replaces one span of the right text and reports the edit the host applied.
    fn replace(right: &str, from: &str, to: &str) -> (String, AppliedEdit) {
        let at = right.find(from).expect("the span exists");
        let edited = format!("{}{}{}", &right[..at], to, &right[at + from.len()..]);
        let edit = AppliedEdit {
            side: PatchSide::Right,
            start: at as u32,
            end: (at + from.len()) as u32,
            by: to.len() as i64 - from.len() as i64,
        };
        (edited, edit)
    }

    /// Inserts text at `marker` without replacing anything.
    fn insert_at(right: &str, marker: &str, text: &str) -> (String, AppliedEdit) {
        let at = right.find(marker).expect("the marker exists");
        let edited = format!("{}{}{}", &right[..at], text, &right[at..]);
        let edit = AppliedEdit {
            side: PatchSide::Right,
            start: at as u32,
            end: at as u32,
            by: text.len() as i64,
        };
        (edited, edit)
    }

    fn patch_of(before: &DiffDocument, after: &DiffDocument, edit: AppliedEdit) -> DiffPatch {
        match patch_between(before, after, edit) {
            PatchOutcome::Patch(patch) => patch,
            PatchOutcome::Unpatchable(reason) => panic!("expected a patch, got {reason}"),
        }
    }

    #[test]
    fn a_value_change_patches_its_parent_block_and_shifts_later_ranges() {
        let (right, edit) = replace(DOC, "<VALUE>1</VALUE>", "<VALUE>19</VALUE>");
        let before = document(DOC);
        let after = document(&right);
        let patch = patch_of(&before, &after, edit);
        assert!(patch.rows.len() < after.rows.len());
        assert!(
            patch.shift.is_some(),
            "the extra character shifts later ranges"
        );
        assert_eq!(apply_patch(&before, &patch).rows, after.rows);
        assert_eq!(apply_patch(&before, &patch).summary, after.summary);
    }

    #[test]
    fn an_added_parameter_patches_the_child_block() {
        let (right, edit) = insert_at(
            DOC,
            "              </PARAMETER-VALUES>",
            r#"                <ECUC-NUMERICAL-PARAM-VALUE>
                  <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/Mod/Cont/R</DEFINITION-REF>
                  <VALUE>3</VALUE>
                </ECUC-NUMERICAL-PARAM-VALUE>
"#,
        );
        let before = document(DOC);
        let after = document(&right);
        let patch = patch_of(&before, &after, edit);
        assert!(patch
            .rows
            .iter()
            .any(|row| row.left.as_ref().is_some_and(|cell| cell.label == "R")));
        assert_eq!(apply_patch(&before, &patch).rows, after.rows);
    }

    #[test]
    fn a_removed_parameter_patches_the_child_block() {
        let span = r#"                <ECUC-NUMERICAL-PARAM-VALUE>
                  <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/Mod/Cont/P</DEFINITION-REF>
                  <VALUE>1</VALUE>
                </ECUC-NUMERICAL-PARAM-VALUE>
"#;
        let (right, edit) = replace(DOC, span, "");
        let before = document(DOC);
        let after = document(&right);
        let patch = patch_of(&before, &after, edit);
        assert_eq!(
            patch.shift.as_ref().map(|shift| shift.by),
            Some(-(span.len() as i64))
        );
        assert_eq!(apply_patch(&before, &patch).rows, after.rows);
    }

    #[test]
    fn a_module_label_changes_the_top_level_identity() {
        // A module's key contains its short name, so renaming it changes the level-1
        // key set; that is the module-row case the fallback exists for.
        let (right, edit) = replace(
            DOC,
            "<SHORT-NAME>Mod</SHORT-NAME>",
            "<SHORT-NAME>Mod2</SHORT-NAME>",
        );
        let before = document(DOC);
        let after = document(&right);
        assert_eq!(
            patch_between(&before, &after, edit),
            PatchOutcome::Unpatchable("top-level-order")
        );
    }

    #[test]
    fn a_new_module_is_unpatchable() {
        let extra = r#"        <ECUC-MODULE-CONFIGURATION-VALUES>
          <SHORT-NAME>Other</SHORT-NAME>
          <DEFINITION-REF DEST="ECUC-MODULE-DEF">/Pkg/Other</DEFINITION-REF>
          <CONTAINERS/>
        </ECUC-MODULE-CONFIGURATION-VALUES>
"#;
        let (right, edit) = replace(
            DOC,
            "      </ELEMENTS>",
            &format!("{extra}      </ELEMENTS>"),
        );
        let before = document(DOC);
        let after = document(&right);
        assert_eq!(
            patch_between(&before, &after, edit),
            PatchOutcome::Unpatchable("top-level-order")
        );
    }

    #[test]
    fn a_whitespace_only_edit_is_unpatchable() {
        let (right, edit) = replace(DOC, "  <AR-PACKAGES>", "\n  <AR-PACKAGES>");
        let before = document(DOC);
        let after = document(&right);
        assert_eq!(
            patch_between(&before, &after, edit),
            PatchOutcome::Unpatchable("outside-elements")
        );
    }

    #[test]
    fn two_copies_in_a_row_patch_against_the_previous_result() {
        // First copy: a value edit.
        let (first_text, first_edit) = replace(DOC, "<VALUE>1</VALUE>", "<VALUE>19</VALUE>");
        let first = document(&first_text);
        let first_patch = patch_of(&document(DOC), &first, first_edit);
        let after_first = apply_patch(&document(DOC), &first_patch);
        assert_eq!(after_first.rows, first.rows);
        // Second copy: add a parameter to the same parent.
        let (second_text, second_edit) = insert_at(
            &first_text,
            "              </PARAMETER-VALUES>",
            r#"                <ECUC-NUMERICAL-PARAM-VALUE>
                  <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/Pkg/Mod/Cont/R</DEFINITION-REF>
                  <VALUE>3</VALUE>
                </ECUC-NUMERICAL-PARAM-VALUE>
"#,
        );
        let second = document(&second_text);
        let second_patch = patch_of(&first, &second, second_edit);
        assert_eq!(apply_patch(&first, &second_patch).rows, second.rows);
    }

    #[test]
    fn an_edit_outside_elements_is_unpatchable() {
        // Offset 0 is the XML declaration: no element contains it.
        let edit = AppliedEdit {
            side: PatchSide::Right,
            start: 0,
            end: 0,
            by: 0,
        };
        assert_eq!(
            patch_between(&document(DOC), &document(DOC), edit),
            PatchOutcome::Unpatchable("outside-elements")
        );
    }

    #[test]
    fn a_nested_container_add_keeps_the_patch_local() {
        let anchor = "            </ECUC-CONTAINER-VALUE>\n          </CONTAINERS>";
        let (right, edit) = replace(
            DOC,
            anchor,
            r#"              <SUB-CONTAINERS>
                <ECUC-CONTAINER-VALUE>
                  <SHORT-NAME>Inner</SHORT-NAME>
                  <DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/Pkg/Mod/Cont/Inner</DEFINITION-REF>
                </ECUC-CONTAINER-VALUE>
              </SUB-CONTAINERS>
            </ECUC-CONTAINER-VALUE>
          </CONTAINERS>"#,
        );
        let before = document(DOC);
        let after = document(&right);
        let patch = patch_of(&before, &after, edit);
        assert!(patch.rows.len() < after.rows.len());
        assert_eq!(apply_patch(&before, &patch).rows, after.rows);
    }
}
