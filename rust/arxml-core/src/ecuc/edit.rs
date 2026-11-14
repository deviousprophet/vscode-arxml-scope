//! The edit plan: validate, locate the byte region, describe the replacement.
//!
//! An edit record names a **region**, never an offset: a value's length changes when
//! it is edited, so every offset after it shifts. The host applies the returned
//! record as exactly one `WorkspaceEdit`; the engine never writes a file. Ported
//! from `host/ecucEdit.ts` with the same refusal strings.

use serde::Serialize;

use super::model::{ContainerNode, EcucDocumentModel, ParameterNode, Range};
use super::node_id::{NodeIndex, NodeKind};
use super::text::SourceText;
use super::validate::{validate_definition_ref, validate_short_name, validate_value};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditRecord {
    pub node_id: String,
    pub region: String,
    /// The UTF-16 span the host must replace, so it never has to re-scan to find it.
    pub range: Range,
    pub old_text: String,
    pub new_text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditPlan {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<EditRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_node_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl EditPlan {
    fn refusal(reason: impl Into<String>) -> Self {
        Self {
            ok: false,
            record: None,
            next_node_id: None,
            reason: Some(reason.into()),
        }
    }

    fn ok(record: EditRecord, next_node_id: Option<String>) -> Self {
        Self {
            ok: true,
            record: Some(record),
            next_node_id,
            reason: None,
        }
    }
}

/// A `<VALUE>` text (or whole element) replacement.
pub fn plan_value_edit(
    model: &EcucDocumentModel,
    index: &NodeIndex,
    text: &SourceText,
    node_id: &str,
    value: &str,
) -> EditPlan {
    let Some(entry) = index.get(node_id) else {
        return EditPlan::refusal("the node is no longer in the file");
    };
    if entry.kind != NodeKind::Parameter {
        return EditPlan::refusal("the node is not a parameter");
    }
    let Some(parameter) = find_parameter(model, entry.range) else {
        return EditPlan::refusal("the node is no longer in the file");
    };
    let Some(value_range) = parameter.value_range else {
        return EditPlan::refusal(format!(
            "\"{}\" has no <VALUE> element to edit",
            parameter.name
        ));
    };
    if touches_cdata(text, value_range) {
        return EditPlan::refusal(format!(
            "\"{}\" is stored in a CDATA section, which this editor does not edit",
            parameter.name
        ));
    }
    let validated = match validate_value(parameter, value) {
        Ok(validated) => validated,
        Err(reason) => return EditPlan::refusal(reason),
    };
    let starts_with_tag = text
        .slice_utf16(value_range.start as usize, value_range.start as usize + 1)
        .starts_with('<');
    let region = if starts_with_tag { "element" } else { "value" };
    let range = if starts_with_tag {
        element_span(text, value_range)
    } else {
        Some(value_range)
    };
    let Some(range) = range.filter(|range| !touches_cdata(text, *range)) else {
        return EditPlan::refusal(format!(
            "\"{}\" has no <VALUE> element to edit",
            parameter.name
        ));
    };
    let old_text = text
        .slice_utf16(range.start as usize, range.end as usize)
        .to_string();
    let new_text = if region == "element" {
        wrap_element(&old_text, &validated.text)
    } else {
        validated.text
    };
    EditPlan::ok(
        EditRecord {
            node_id: node_id.to_string(),
            region: region.to_string(),
            range,
            old_text,
            new_text,
        },
        None,
    )
}

/// A container's `SHORT-NAME` / `DEFINITION-REF` inner-text replacement.
pub fn plan_field_edit(
    model: &EcucDocumentModel,
    index: &NodeIndex,
    text: &SourceText,
    node_id: &str,
    field: &str,
    value: &str,
) -> EditPlan {
    let Some(entry) = index.get(node_id) else {
        return EditPlan::refusal("the node is no longer in the file");
    };
    if entry.kind != NodeKind::Container {
        return EditPlan::refusal("the node is not a container");
    }
    let Some(container) = find_container(model, entry.range) else {
        return EditPlan::refusal("the node is no longer in the file");
    };
    let validated = match field {
        "shortName" => validate_short_name(value),
        "definitionRef" => validate_definition_ref(value),
        _ => return EditPlan::refusal("the field is not editable"),
    };
    let validated = match validated {
        Ok(validated) => validated,
        Err(reason) => return EditPlan::refusal(reason),
    };
    let (range, current) = match field {
        "shortName" => (container.short_name_range, container.short_name.clone()),
        _ => (
            container.definition_ref_range,
            container.definition_ref.clone(),
        ),
    };
    let unavailable = || EditPlan::refusal(missing_field_reason(container, field));
    let Some(range) = range else {
        return unavailable();
    };
    if touches_cdata(text, range) {
        return unavailable();
    }
    let old_text = text
        .slice_utf16(range.start as usize, range.end as usize)
        .to_string();
    if old_text.trim().is_empty() {
        return unavailable();
    }
    if value.trim() == current {
        return EditPlan::refusal(if field == "shortName" {
            "the short name is unchanged"
        } else {
            "the definition ref is unchanged"
        });
    }
    let next_node_id = if field == "shortName" {
        Some(rename_node_id(&entry.id, value))
    } else {
        None
    };
    EditPlan::ok(
        EditRecord {
            node_id: node_id.to_string(),
            region: field.to_string(),
            range,
            old_text,
            new_text: validated.text,
        },
        next_node_id,
    )
}

fn missing_field_reason(container: &ContainerNode, field: &str) -> String {
    let label = format!("\"{}\"", container.short_name);
    if field == "shortName" {
        format!("{label} has no <SHORT-NAME> text to edit (absent, empty or CDATA-backed)")
    } else {
        format!("{label} has no <DEFINITION-REF> text to edit (absent, empty or CDATA-backed)")
    }
}

/// The id a renamed container will carry: the ordinal is preserved, the last segment changes.
fn rename_node_id(id: &str, new_name: &str) -> String {
    let Some(hash) = id.rfind('#') else {
        return id.to_string();
    };
    let Some(slash) = id[..hash].rfind('/') else {
        return id.to_string();
    };
    format!("{}{new_name}{}", &id[..=slash], &id[hash..])
}

/// The whole `<VALUE>…</VALUE>` element around `value_range`.
fn element_span(text: &SourceText, value_range: Range) -> Option<Range> {
    if text
        .slice_utf16(value_range.start as usize, value_range.start as usize + 1)
        .starts_with('<')
    {
        return Some(value_range);
    }
    let tail = text.slice_utf16(value_range.end as usize, text.len_utf16());
    let end = match tail.find("</") {
        Some(offset) => tag_end(text, value_range.end as usize + offset)?,
        None => match tail.find('>') {
            Some(offset) => value_range.end as usize + offset + 1,
            None => value_range.end as usize,
        },
    };
    let before = text.slice_utf16(0, value_range.start as usize);
    let start = match before.rfind('<') {
        Some(index) => before[..index].encode_utf16().count(),
        None => value_range.start as usize,
    };
    Some(Range {
        start: start as u32,
        end: end.max(start) as u32,
    })
}

/// Offset just past the `>` that ends the tag starting at `start`, quote-aware.
fn tag_end(text: &SourceText, start: usize) -> Option<usize> {
    let rest = text.slice_utf16(start, text.len_utf16());
    let mut quote: Option<char> = None;
    for (offset, ch) in rest.char_indices() {
        match quote {
            Some(open) => {
                if ch == open {
                    quote = None;
                }
            }
            None => {
                if ch == '"' || ch == '\'' {
                    quote = Some(ch);
                } else if ch == '>' {
                    return Some(start + rest[..=offset].encode_utf16().count());
                }
            }
        }
    }
    None
}

/// The exact string that will occupy an `element` region: open tag + escaped + close tag.
pub fn wrap_element(slice: &str, escaped: &str) -> String {
    let gt = tag_end_in_slice(slice);
    let open = open_tag(slice, gt);
    open.clone() + escaped + &closing_tag(slice, &open, gt)
}

fn tag_end_in_slice(slice: &str) -> usize {
    let mut quote: Option<char> = None;
    for (offset, ch) in slice.char_indices() {
        match quote {
            Some(open) => {
                if ch == open {
                    quote = None;
                }
            }
            None => {
                if ch == '"' || ch == '\'' {
                    quote = Some(ch);
                } else if ch == '>' {
                    return offset + 1;
                }
            }
        }
    }
    usize::MAX
}

/// The element's own open tag, kept verbatim apart from a dropped self-closing slash.
fn open_tag(slice: &str, gt: usize) -> String {
    let tag = if gt == usize::MAX {
        slice
    } else {
        &slice[..gt]
    };
    let tag = tag.trim_end();
    let tag = tag.strip_suffix('>').unwrap_or(tag);
    let body = tag.trim_end_matches(|ch: char| ch.is_whitespace() || ch == '/');
    format!("{body}>")
}

fn closing_tag(slice: &str, open: &str, gt: usize) -> String {
    let lt = slice.rfind('<');
    let has_close = match lt {
        Some(lt) => gt != usize::MAX && lt >= gt && slice[lt + 1..].starts_with('/'),
        None => false,
    };
    match lt {
        Some(lt) if has_close => slice[lt..].to_string(),
        _ => format!("</{}>", tag_name(open)),
    }
}

fn tag_name(open: &str) -> String {
    open.trim_start_matches('<')
        .split([' ', '/', '>'])
        .next()
        .unwrap_or("")
        .to_string()
}

/// True when `range` is inside, or straddles, a `<![CDATA[…]]>` section.
pub fn touches_cdata(text: &SourceText, range: Range) -> bool {
    let slice = text.slice_utf16(range.start as usize, range.end as usize);
    if slice.contains("<![CDATA[") || slice.contains("]]>") {
        return true;
    }
    let before = text.slice_utf16(0, range.start as usize);
    let Some(open) = before.rfind("<![CDATA[") else {
        return false;
    };
    let open_utf16 = before[..open].encode_utf16().count();
    let after = text.slice_utf16(open_utf16 + 9, text.len_utf16());
    match after.find("]]>") {
        Some(close) => (open_utf16 + 9 + close) as u32 > range.start,
        None => true,
    }
}

fn find_parameter(model: &EcucDocumentModel, range: Range) -> Option<&ParameterNode> {
    for module in &model.modules {
        if let Some(found) = walk_containers(&module.containers, &mut |container| {
            container
                .parameters
                .iter()
                .find(|parameter| parameter.range == range)
        }) {
            return Some(found);
        }
    }
    None
}

fn find_container(model: &EcucDocumentModel, range: Range) -> Option<&ContainerNode> {
    for module in &model.modules {
        if let Some(found) = walk_containers(&module.containers, &mut |container| {
            (container.range == range).then_some(container)
        }) {
            return Some(found);
        }
    }
    None
}

fn walk_containers<'a, T>(
    containers: &'a [ContainerNode],
    find: &mut impl FnMut(&'a ContainerNode) -> Option<T>,
) -> Option<T> {
    for container in containers {
        if let Some(found) = find(container) {
            return Some(found);
        }
        if let Some(found) = walk_containers(&container.containers, find) {
            return Some(found);
        }
    }
    None
}
