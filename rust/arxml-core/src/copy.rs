//! The merge-mode copy planner.
//!
//! One arrow copies one ECUC element from the pane that was clicked into the other
//! pane. This module turns that intent into the single text edit the host applies:
//!
//!   both sides have the row  -> replace the target element with the source element
//!   only the source has it   -> insert it after (or before) a target sibling
//!   only the target has it   -> delete the target element with its line
//!
//! Offsets are UTF-16, the unit the diff and `WorkspaceEdit` use. Pure: no Node and
//! no VS Code, so the engine process and the CLI share one implementation.

use serde::{Deserialize, Serialize};

use crate::ecuc::SourceText;

/// The target has no sibling to place this element next to.
pub const NO_ANCHOR: &str = "the target has no sibling to place this element next to";
/// The comparison changed between the click and the plan.
pub const STALE: &str = "the comparison changed; reload and try again";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyRange {
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopySpan {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

/// One arrow's answer: the span to write, or why it cannot be written.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyPlan {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<CopySpan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl CopyPlan {
    fn written(span: CopySpan) -> Self {
        Self {
            ok: true,
            span: Some(span),
            reason: None,
        }
    }

    fn refused(reason: impl Into<String>) -> Self {
        Self {
            ok: false,
            span: None,
            reason: Some(reason.into()),
        }
    }
}

/// The kind of element nested inside a missing ancestor.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChildKind {
    Container,
    Parameter,
    Reference,
}

impl ChildKind {
    fn list_tag(self) -> &'static str {
        match self {
            Self::Container => "SUB-CONTAINERS",
            Self::Parameter => "PARAMETER-VALUES",
            Self::Reference => "REFERENCE-VALUES",
        }
    }
}

/// One missing container between the copied element and the target parent.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingAncestor {
    pub short_name: String,
    pub definition_ref: String,
    pub definition_dest: String,
    pub child_kind: ChildKind,
}

/// The ranges one arrow resolved to; the engine supplies the two document texts.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CopySpec {
    pub source: CopyRange,
    pub target: Option<CopyRange>,
    pub anchor_after: Option<CopyRange>,
    pub anchor_before: Option<CopyRange>,
    pub ancestors: Vec<MissingAncestor>,
}

fn line_start(text: &SourceText, from: usize) -> usize {
    let mut byte = text.byte_at_utf16(from);
    let bytes = text.as_str().as_bytes();
    while byte > 0 && bytes[byte - 1] != b'\n' && bytes[byte - 1] != b'\r' {
        byte -= 1;
    }
    text.utf16_at_byte(byte)
}

fn line_end(text: &SourceText, from: usize) -> usize {
    let mut byte = text.byte_at_utf16(from);
    let bytes = text.as_str().as_bytes();
    while byte < bytes.len() && bytes[byte] != b'\n' && bytes[byte] != b'\r' {
        byte += 1;
    }
    text.utf16_at_byte(byte)
}

fn blank(text: &SourceText, start: usize, end: usize) -> bool {
    text.slice_utf16(start, end).trim().is_empty()
}

/// True when the element owns both ends of its line.
fn owns_whole_line(text: &SourceText, range: CopyRange, start: usize, end: usize) -> bool {
    blank(text, start, range.start) && blank(text, range.end, end)
}

/// The offset past the line break that starts at `end`, if any.
fn after_line_break(text: &SourceText, end: usize) -> usize {
    if end >= text.len_utf16() {
        return end;
    }
    let bytes = text.as_str().as_bytes();
    let byte = text.byte_at_utf16(end);
    if bytes.get(byte) == Some(&b'\r') && bytes.get(byte + 1) == Some(&b'\n') {
        text.utf16_at_byte(byte + 2)
    } else {
        text.utf16_at_byte(byte + 1)
    }
}

/// The whole-line span for an element that owns its line, or `None`.
fn whole_line_span(text: &SourceText, range: CopyRange) -> Option<CopyRange> {
    let start = line_start(text, range.start);
    let end = line_end(text, range.end);
    owns_whole_line(text, range, start, end).then(|| CopyRange {
        start,
        end: after_line_break(text, end),
    })
}

/// The span that removes an element: its line when it owns it, else just the element.
pub fn removal_span(text: &SourceText, range: CopyRange) -> CopyRange {
    whole_line_span(text, range).unwrap_or(range)
}

/// The indentation of the line the offset sits on.
pub fn indentation_at(text: &SourceText, offset: usize) -> String {
    let start = line_start(text, offset);
    let mut byte = text.byte_at_utf16(start);
    let bytes = text.as_str().as_bytes();
    while byte < bytes.len() && (bytes[byte] == b' ' || bytes[byte] == b'\t') {
        byte += 1;
    }
    text.slice_utf16(start, text.utf16_at_byte(byte))
        .to_string()
}

/// The document's own line break, the one a copied block must adopt.
pub fn line_break_of(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

/// One line of a copied block, shifted by the indent delta.
fn shift_line(line: &str, source_indent: &str, target_indent: &str) -> String {
    if line.trim().is_empty() {
        return line.to_string();
    }
    let lead = line.len() - line.trim_start_matches([' ', '\t']).len();
    let width = (lead as isize + target_indent.len() as isize - source_indent.len() as isize).max(0)
        as usize;
    format!("{}{}", " ".repeat(width), &line[lead..])
}

/// Shifts every line of a copied block by the difference between the two indents.
pub fn reindent(block: &str, source_indent: &str, target_indent: &str, line_break: &str) -> String {
    let mut out = String::with_capacity(block.len());
    for (index, raw) in block.split('\n').enumerate() {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if index > 0 {
            out.push_str(line_break);
        }
        if index == 0 {
            out.push_str(line);
        } else {
            out.push_str(&shift_line(line, source_indent, target_indent));
        }
    }
    out
}

/// One ancestor element wrapping the block below it.
fn wrap_one(
    block: &str,
    child_indent: &str,
    ancestor: &MissingAncestor,
    wrapper_indent: &str,
    line_break: &str,
) -> String {
    let field_indent = format!("{wrapper_indent}  ");
    let list = ancestor.child_kind.list_tag();
    [
        "<ECUC-CONTAINER-VALUE>".to_string(),
        format!(
            "{field_indent}<SHORT-NAME>{}</SHORT-NAME>",
            ancestor.short_name
        ),
        format!(
            "{field_indent}<DEFINITION-REF DEST=\"{}\">{}</DEFINITION-REF>",
            ancestor.definition_dest, ancestor.definition_ref
        ),
        format!("{field_indent}<{list}>"),
        format!("{child_indent}{block}"),
        format!("{field_indent}</{list}>"),
        format!("{wrapper_indent}</ECUC-CONTAINER-VALUE>"),
    ]
    .join(line_break)
}

/// Wraps a copied element in the missing ancestor containers, as minimal containers:
/// their own short name, definition ref and one child list holding only the copied
/// chain. Copying the source ancestors verbatim would import their unrelated children.
pub fn wrap_with_ancestors(
    element_text: &str,
    element_indent: &str,
    ancestors: &[MissingAncestor],
    target_indent: &str,
    line_break: &str,
) -> String {
    let mut block = reindent(
        element_text,
        element_indent,
        &format!("{target_indent}{}", "    ".repeat(ancestors.len())),
        line_break,
    );
    let mut block_indent = format!("{target_indent}{}", "    ".repeat(ancestors.len()));
    for (index, ancestor) in ancestors.iter().enumerate().rev() {
        let wrapper_indent = format!("{target_indent}{}", "    ".repeat(index));
        block = wrap_one(&block, &block_indent, ancestor, &wrapper_indent, line_break);
        block_indent = wrapper_indent;
    }
    block
}

fn replacement(target: &SourceText, source: &SourceText, spec: &CopySpec) -> CopyPlan {
    let Some(range) = spec.target else {
        return CopyPlan::refused(STALE);
    };
    let source_indent = indentation_at(source, spec.source.start);
    let block = source.slice_utf16(spec.source.start, spec.source.end);
    CopyPlan::written(CopySpan {
        start: range.start,
        end: range.end,
        text: reindent(
            block,
            &source_indent,
            &indentation_at(target, range.start),
            line_break_of(target.as_str()),
        ),
    })
}

fn insertion(target: &SourceText, source: &SourceText, spec: &CopySpec) -> CopyPlan {
    let target_indent = match (spec.anchor_after, spec.anchor_before) {
        (Some(anchor), _) => indentation_at(target, anchor.start),
        (None, Some(anchor)) => indentation_at(target, anchor.start),
        (None, None) => return CopyPlan::refused(NO_ANCHOR),
    };
    let source_indent = indentation_at(source, spec.source.start);
    let block = source.slice_utf16(spec.source.start, spec.source.end);
    let line_break = line_break_of(target.as_str());
    let text = if spec.ancestors.is_empty() {
        reindent(block, &source_indent, &target_indent, line_break)
    } else {
        wrap_with_ancestors(
            block,
            &source_indent,
            &spec.ancestors,
            &target_indent,
            line_break,
        )
    };
    if let Some(anchor) = spec.anchor_after {
        return CopyPlan::written(CopySpan {
            start: anchor.end,
            end: anchor.end,
            text: format!("{line_break}{target_indent}{text}"),
        });
    }
    let anchor = spec.anchor_before.expect("checked above");
    CopyPlan::written(CopySpan {
        start: anchor.start,
        end: anchor.start,
        text: format!("{text}{line_break}{target_indent}"),
    })
}

fn deletion(target: &SourceText, range: CopyRange) -> CopyPlan {
    let span = removal_span(target, range);
    CopyPlan::written(CopySpan {
        start: span.start,
        end: span.end,
        text: String::new(),
    })
}

/// One arrow's edit, or the reason it cannot be made.
pub fn plan_copy(target: &SourceText, source: &SourceText, spec: &CopySpec) -> CopyPlan {
    if spec.target.is_some() {
        return replacement(target, source, spec);
    }
    if spec.anchor_after.is_some() || spec.anchor_before.is_some() {
        return insertion(target, source, spec);
    }
    CopyPlan::refused(NO_ANCHOR)
}

/// A copy that removes the target row (the source pane has no cell for it).
pub fn plan_delete(target: &SourceText, range: Option<CopyRange>) -> CopyPlan {
    match range {
        Some(range) => deletion(target, range),
        None => CopyPlan::refused(STALE),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OURS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <CONTAINERS>
    <ECUC-CONTAINER-VALUE>
      <SHORT-NAME>C</SHORT-NAME>
      <PARAMETER-VALUES>
        <ECUC-NUMERICAL-PARAM-VALUE>
          <DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/C/P1</DEFINITION-REF>
          <VALUE>1</VALUE>
        </ECUC-NUMERICAL-PARAM-VALUE>
      </PARAMETER-VALUES>
    </ECUC-CONTAINER-VALUE>
  </CONTAINERS>
</AUTOSAR>
"#;

    fn span(text: &str, needle: &str, close: &str) -> CopyRange {
        let start = text.find(needle).expect("the fixture has the opening tag");
        let end = text[start..]
            .find(close)
            .expect("the fixture has the closing tag")
            + start
            + close.len();
        CopyRange { start, end }
    }

    fn ours_range() -> CopyRange {
        span(
            OURS,
            "<ECUC-NUMERICAL-PARAM-VALUE>",
            "</ECUC-NUMERICAL-PARAM-VALUE>",
        )
    }

    fn theirs(value: &str) -> String {
        OURS.replace("<VALUE>1</VALUE>", &format!("<VALUE>{value}</VALUE>"))
    }

    fn text(value: &str) -> SourceText {
        SourceText::new(value.to_string())
    }

    #[test]
    fn replaces_the_target_element_with_the_source_element() {
        let source_text = theirs("22");
        let source = text(&source_text);
        let target = text(OURS);
        let spec = CopySpec {
            source: span(
                &source_text,
                "<ECUC-NUMERICAL-PARAM-VALUE>",
                "</ECUC-NUMERICAL-PARAM-VALUE>",
            ),
            target: Some(ours_range()),
            ..CopySpec::default()
        };
        let plan = plan_copy(&target, &source, &spec);
        assert!(plan.ok);
        let span = plan.span.unwrap();
        let result = format!("{}{}{}", &OURS[..span.start], span.text, &OURS[span.end..]);
        assert_eq!(result, source_text);
    }

    #[test]
    fn deletes_an_element_with_its_line() {
        let two = OURS.replace(
            "      </PARAMETER-VALUES>",
            "        <ECUC-NUMERICAL-PARAM-VALUE>\n          <DEFINITION-REF DEST=\"ECUC-INTEGER-PARAM-DEF\">/P/C/P2</DEFINITION-REF>\n          <VALUE>2</VALUE>\n        </ECUC-NUMERICAL-PARAM-VALUE>\n      </PARAMETER-VALUES>",
        );
        let start = two.rfind("<ECUC-NUMERICAL-PARAM-VALUE>").unwrap();
        assert_eq!(
            two.matches("<ECUC-NUMERICAL-PARAM-VALUE>").count(),
            2,
            "the second parameter was inserted"
        );
        let end = two[start..].find("</ECUC-NUMERICAL-PARAM-VALUE>").unwrap()
            + start
            + "</ECUC-NUMERICAL-PARAM-VALUE>".len();
        let target = text(&two);
        let plan = plan_delete(&target, Some(CopyRange { start, end }));
        assert!(plan.ok);
        let span = plan.span.unwrap();
        assert_eq!(span.text, "");
        let result = format!("{}{}", &two[..span.start], &two[span.end..]);
        assert!(result.contains("<VALUE>1</VALUE>"));
        assert!(!result.contains("<VALUE>2</VALUE>"));
        assert!(!result.contains("\n\n"));
    }

    #[test]
    fn inserts_after_the_anchor_with_the_target_indentation() {
        let source_text = theirs("22");
        let source = text(&source_text);
        let target = text(OURS);
        let spec = CopySpec {
            source: span(
                &source_text,
                "<ECUC-NUMERICAL-PARAM-VALUE>",
                "</ECUC-NUMERICAL-PARAM-VALUE>",
            ),
            anchor_after: Some(ours_range()),
            ..CopySpec::default()
        };
        let plan = plan_copy(&target, &source, &spec);
        assert!(plan.ok);
        let span = plan.span.unwrap();
        let result = format!("{}{}{}", &OURS[..span.start], span.text, &OURS[span.end..]);
        assert!(result.contains("\n        <ECUC-NUMERICAL-PARAM-VALUE>"));
    }

    #[test]
    fn refuses_an_insertion_without_an_anchor() {
        let source_text = theirs("2");
        let plan = plan_copy(
            &text(OURS),
            &text(&source_text),
            &CopySpec {
                source: ours_range(),
                ..CopySpec::default()
            },
        );
        assert!(!plan.ok);
        assert_eq!(plan.reason.as_deref(), Some(NO_ANCHOR));
    }

    #[test]
    fn reindents_by_the_delta_not_by_a_prefix_assumption() {
        assert_eq!(
            reindent("<A>\n      <B/>\n    </A>", "    ", "      ", "\n"),
            "<A>\n        <B/>\n      </A>"
        );
        assert_eq!(
            reindent("<A>\n      <B/>\n    </A>", "      ", "    ", "\n"),
            "<A>\n    <B/>\n  </A>"
        );
    }

    #[test]
    fn a_removal_span_keeps_inline_elements_intact() {
        let inline = "text <VALUE>x</VALUE> tail";
        let range = span(inline, "<VALUE>", "</VALUE>");
        assert_eq!(removal_span(&text(inline), range), range);
    }

    #[test]
    fn line_endings_follow_the_target_document() {
        let crlf = OURS.replace('\n', "\r\n");
        let start = crlf.find("<ECUC-NUMERICAL-PARAM-VALUE>").unwrap();
        let end = crlf.find("</ECUC-NUMERICAL-PARAM-VALUE>").unwrap()
            + "</ECUC-NUMERICAL-PARAM-VALUE>".len();
        let source = text(OURS);
        let target = text(&crlf);
        let plan = plan_copy(
            &target,
            &source,
            &CopySpec {
                source: ours_range(),
                anchor_after: Some(CopyRange { start, end }),
                ..CopySpec::default()
            },
        );
        assert!(plan.ok);
        let text = plan.span.unwrap().text;
        assert!(text.starts_with("\r\n"));
        assert!(!text
            .char_indices()
            .any(|(at, ch)| { ch == '\n' && (at == 0 || text.as_bytes()[at - 1] != b'\r') }));
    }

    #[test]
    fn utf16_offsets_survive_a_non_ascii_prefix() {
        let target_text = format!("<!--é-->\n{OURS}");
        let target = text(&target_text);
        let offset = target_text.find("<ECUC-NUMERICAL-PARAM-VALUE>").unwrap();
        let range = CopyRange {
            start: offset,
            end: offset + "<ECUC-NUMERICAL-PARAM-VALUE>".len(),
        };
        let plan = plan_delete(&target, Some(range));
        assert!(plan.ok, "the range is a valid UTF-16 span");
    }

    #[test]
    fn wraps_a_copied_parameter_in_a_minimal_container() {
        let element = "<ECUC-NUMERICAL-PARAM-VALUE>\n          <VALUE>1</VALUE>\n        </ECUC-NUMERICAL-PARAM-VALUE>";
        let ancestors = [MissingAncestor {
            short_name: "B".into(),
            definition_ref: "/P/A/B".into(),
            definition_dest: "ECUC-PARAM-CONF-CONTAINER-DEF".into(),
            child_kind: ChildKind::Parameter,
        }];
        let wrapped = wrap_with_ancestors(element, "        ", &ancestors, "    ", "\n");
        assert!(wrapped.starts_with("<ECUC-CONTAINER-VALUE>"));
        assert!(wrapped.contains("<SHORT-NAME>B</SHORT-NAME>"));
        assert!(wrapped.contains("DEST=\"ECUC-PARAM-CONF-CONTAINER-DEF\""));
        assert!(wrapped.contains("<PARAMETER-VALUES>"));
        assert!(wrapped.contains("<VALUE>1</VALUE>"));
        assert!(!wrapped.contains("<SUB-CONTAINERS>"));
        assert!(wrapped.trim_end().ends_with("</ECUC-CONTAINER-VALUE>"));
    }

    #[test]
    fn nests_the_whole_missing_chain() {
        let element = "<ECUC-NUMERICAL-PARAM-VALUE>\n          <VALUE>1</VALUE>\n        </ECUC-NUMERICAL-PARAM-VALUE>";
        let ancestors = [
            MissingAncestor {
                short_name: "A".into(),
                definition_ref: "/P/A".into(),
                definition_dest: "ECUC-PARAM-CONF-CONTAINER-DEF".into(),
                child_kind: ChildKind::Container,
            },
            MissingAncestor {
                short_name: "B".into(),
                definition_ref: "/P/A/B".into(),
                definition_dest: "ECUC-PARAM-CONF-CONTAINER-DEF".into(),
                child_kind: ChildKind::Parameter,
            },
        ];
        let wrapped = wrap_with_ancestors(element, "        ", &ancestors, "  ", "\n");
        let a = wrapped.find("<SHORT-NAME>A</SHORT-NAME>").unwrap();
        let b = wrapped.find("<SHORT-NAME>B</SHORT-NAME>").unwrap();
        assert!(a < b, "A wraps B");
        assert!(wrapped.contains("  <SUB-CONTAINERS>"));
        assert!(wrapped.contains("      <PARAMETER-VALUES>"));
    }

    #[test]
    fn a_crlf_target_gets_crlf_through_the_ancestor_wrapper() {
        let element = "<A>\n  <B/>\n</A>";
        let ancestors = [MissingAncestor {
            short_name: "C".into(),
            definition_ref: "/P/C".into(),
            definition_dest: "ECUC-PARAM-CONF-CONTAINER-DEF".into(),
            child_kind: ChildKind::Container,
        }];
        let wrapped = wrap_with_ancestors(element, "  ", &ancestors, "    ", "\r\n");
        assert!(!wrapped
            .char_indices()
            .any(|(at, ch)| ch == '\n' && (at == 0 || wrapped.as_bytes()[at - 1] != b'\r')));
    }
}
