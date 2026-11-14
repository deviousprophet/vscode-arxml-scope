//! Row data for the virtualised ECUC views.
//!
//! One plain object per entity in DFS/display order, with children contiguous after
//! their parent so `subtreeSize` is a complete collapse index. This is the port of
//! the structural half of `core/ecuc/renderRows.ts`; the workspace-index fields
//! (`definition`, `definitionCount`, cross-file `followable`) are added by the host,
//! which owns the index.

use std::collections::HashMap;

use serde::Serialize;

use super::model::{
    last_short_name, resolve_path, Annotation, ContainerNode, EcucDocumentModel, ModuleNode,
    ParameterNode, PathIndex, ReferenceNode, SortMode, Suffixes,
};
use super::node_id::{build_node_index, NodeIndex};
use super::order::{order_containers, order_members, order_modules, SORT_EXCEPTIONS};
use super::syscond::{evaluate_syscond, ConditionResult, ConditionState, ConditionValue};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaPart {
    pub cls: String,
    pub text: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<ConditionState>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowCondition {
    pub text: String,
    pub state: ConditionState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub missing: Vec<String>,
    pub symbols: Vec<String>,
    pub values: HashMap<String, ConditionValue>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParameterFormat {
    pub label: String,
    pub value: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub id: String,
    pub kind: String,
    pub level: u32,
    pub parent_id: Option<String>,
    pub subtree_size: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub empty: Option<bool>,
    pub posinset: u32,
    pub setsize: u32,
    pub has_children: bool,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_name: Option<String>,
    pub definition_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_dest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameter_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formats: Option<Vec<ParameterFormat>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shown_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub followable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follow_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_paths: Option<Vec<String>>,
    pub title: String,
    pub meta: Vec<MetaPart>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comments: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<RowCondition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled_by: Option<String>,
    pub haystack: String,
}

/// The options a row build needs: everything except the host's workspace index.
#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowOptions {
    #[serde(default)]
    pub sort: Option<SortMode>,
    #[serde(default)]
    pub sort_except: Option<Vec<String>>,
    #[serde(default)]
    pub conditions: Option<HashMap<String, ConditionValue>>,
}

struct BuildContext<'a> {
    index: NodeIndex,
    sort: String,
    except: Vec<String>,
    path_index: &'a PathIndex,
    conditions: HashMap<String, ConditionValue>,
}

const PARAMETER_TYPES: [(&str, &str); 7] = [
    ("ECUC-INTEGER-PARAM-DEF", "Integer"),
    ("ECUC-FLOAT-PARAM-DEF", "Float"),
    ("ECUC-BOOLEAN-PARAM-DEF", "Boolean"),
    ("ECUC-STRING-PARAM-DEF", "String"),
    ("ECUC-ENUMERATION-PARAM-DEF", "Enumeration"),
    ("ECUC-FUNCTION-NAME-DEF", "Function name"),
    ("ECUC-LINKER-SYMBOL-DEF", "Linker symbol"),
];

const UNFORMATTED_TYPES: [&str; 6] = [
    "Boolean",
    "Textual",
    "String",
    "Enumeration",
    "Function name",
    "Linker symbol",
];

/// Builds the row document from the model.
pub fn build_rows(model: &EcucDocumentModel, options: &RowOptions) -> Vec<Row> {
    let mut ctx = BuildContext {
        index: build_node_index(model),
        sort: options.sort.clone().unwrap_or_else(|| "all".to_string()),
        except: options
            .sort_except
            .clone()
            .unwrap_or_else(|| SORT_EXCEPTIONS.iter().map(|s| s.to_string()).collect()),
        path_index: &model.path_index,
        conditions: options.conditions.clone().unwrap_or_default(),
    };
    let mut rows = Vec::new();
    let modules = order_modules(&model.modules, &ctx.sort, &ctx.except);
    let count = modules.len();
    for (position, index) in modules.into_iter().enumerate() {
        module_row(
            &mut ctx,
            &mut rows,
            &model.modules[index],
            1,
            position as u32 + 1,
            count as u32,
            None,
            false,
        );
    }
    rows
}

#[allow(clippy::too_many_arguments)]
fn module_row(
    ctx: &mut BuildContext,
    rows: &mut Vec<Row>,
    module: &ModuleNode,
    level: u32,
    posinset: u32,
    setsize: u32,
    parent_id: Option<String>,
    disabled_by_ancestor: bool,
) {
    let start = rows.len();
    let condition = own_condition(&module.suffixes, ctx);
    let mut meta = vec![short_part(&module.short_name)];
    if let Some(variant) = &module.variant {
        meta.push(variant_part(variant));
    }
    meta.extend(suffix_parts(&module.suffixes, condition.as_ref()));
    let label = dotted(&module.definition_ref);
    let row = Row {
        id: ctx.index.id_of(module.range).unwrap_or("").to_string(),
        kind: "module".to_string(),
        level,
        parent_id,
        subtree_size: 0,
        posinset,
        setsize,
        has_children: false,
        label: label.clone(),
        short_name: Some(module.short_name.clone()),
        definition_ref: module.definition_ref.clone(),
        title: module.definition_ref.clone(),
        haystack: haystack(&label, Some(&module.short_name), None, &meta),
        meta: meta.clone(),
        comments: comment_lines(&meta),
        ..Default::default()
    };
    let row_id = row.id.clone();
    let disabled = append_row(rows, row, condition, disabled_by_ancestor);

    let containers = order_containers(&module.containers, &ctx.sort, &ctx.except);
    let count = containers.len();
    for (position, index) in containers.into_iter().enumerate() {
        container_row(
            ctx,
            rows,
            &module.containers[index],
            level + 1,
            position as u32 + 1,
            count as u32,
            Some(row_id.clone()),
            disabled,
        );
    }
    let subtree = (rows.len() - start - 1) as u32;
    let row = &mut rows[start];
    row.has_children = count > 0;
    row.subtree_size = subtree;
}

#[allow(clippy::too_many_arguments)]
fn container_row(
    ctx: &mut BuildContext,
    rows: &mut Vec<Row>,
    container: &ContainerNode,
    level: u32,
    posinset: u32,
    setsize: u32,
    parent_id: Option<String>,
    disabled_by_ancestor: bool,
) {
    let start = rows.len();
    let condition = own_condition(&container.suffixes, ctx);
    let mut meta = vec![short_part(&container.short_name)];
    meta.extend(suffix_parts(&container.suffixes, condition.as_ref()));
    let label = last_short_name(&container.definition_ref).to_string();
    let row = Row {
        id: ctx.index.id_of(container.range).unwrap_or("").to_string(),
        kind: "container".to_string(),
        level,
        parent_id,
        subtree_size: 0,
        posinset,
        setsize,
        has_children: false,
        label: label.clone(),
        short_name: Some(container.short_name.clone()),
        definition_ref: container.definition_ref.clone(),
        title: container.definition_ref.clone(),
        haystack: haystack(&label, Some(&container.short_name), None, &meta),
        meta: meta.clone(),
        comments: comment_lines(&meta),
        ..Default::default()
    };
    let row_id = row.id.clone();
    let disabled = append_row(rows, row, condition, disabled_by_ancestor);

    let (parameters, references) = order_members(
        &container.parameters,
        &container.references,
        &ctx.sort,
        &ctx.except,
    );
    let nested = order_containers(&container.containers, &ctx.sort, &ctx.except);
    let total = (parameters.len() + references.len() + nested.len()) as u32;
    let mut child = 1;
    for index in parameters {
        parameter_row(
            ctx,
            rows,
            &container.parameters[index],
            level + 1,
            child,
            total,
            Some(row_id.clone()),
            disabled,
        );
        child += 1;
    }
    for index in references {
        reference_row(
            ctx,
            rows,
            &container.references[index],
            level + 1,
            child,
            total,
            Some(row_id.clone()),
            disabled,
        );
        child += 1;
    }
    for index in nested {
        container_row(
            ctx,
            rows,
            &container.containers[index],
            level + 1,
            child,
            total,
            Some(row_id.clone()),
            disabled,
        );
        child += 1;
    }
    let subtree = (rows.len() - start - 1) as u32;
    let row = &mut rows[start];
    row.has_children = total > 0;
    row.empty = Some(!row.has_children);
    row.subtree_size = subtree;
}

#[allow(clippy::too_many_arguments)]
fn parameter_row(
    ctx: &mut BuildContext,
    rows: &mut Vec<Row>,
    parameter: &ParameterNode,
    level: u32,
    posinset: u32,
    setsize: u32,
    parent_id: Option<String>,
    disabled_by_ancestor: bool,
) {
    let value = parameter.display_value.clone().unwrap_or_default();
    let shown = if parameter.numeric {
        value.clone()
    } else {
        format!("\"{value}\"")
    };
    let value_kind = parameter_value_kind(parameter, &value);
    let parameter_type = parameter_type(parameter.definition_dest.as_deref(), value_kind);
    let parameter_type_ref = parameter_type.as_str();
    let condition = own_condition(&parameter.suffixes, ctx);
    let meta = suffix_parts(&parameter.suffixes, condition.as_ref());
    let formats = parameter_formats(&value, parameter_type_ref);
    let row = Row {
        id: ctx.index.id_of(parameter.range).unwrap_or("").to_string(),
        kind: "parameter".to_string(),
        level,
        parent_id,
        subtree_size: 0,
        posinset,
        setsize,
        has_children: false,
        label: parameter.name.clone(),
        definition_ref: parameter.definition_ref.clone(),
        definition_dest: parameter.definition_dest.clone(),
        parameter_type: Some(parameter_type_ref.to_string()),
        formats: Some(formats),
        value: Some(value.clone()),
        value_kind: Some(value_kind.to_string()),
        shown_value: Some(shown),
        title: parameter.definition_ref.clone(),
        haystack: haystack(&parameter.name, None, Some(&value), &meta),
        meta: meta.clone(),
        comments: comment_lines(&meta),
        ..Default::default()
    };
    append_row(rows, row, condition, disabled_by_ancestor);
}

#[allow(clippy::too_many_arguments)]
fn reference_row(
    ctx: &mut BuildContext,
    rows: &mut Vec<Row>,
    reference: &ReferenceNode,
    level: u32,
    posinset: u32,
    setsize: u32,
    parent_id: Option<String>,
    disabled_by_ancestor: bool,
) {
    let value = reference
        .target_path
        .clone()
        .or_else(|| reference.target_raw_path.clone())
        .unwrap_or_default();
    let raw = reference
        .target_raw_path
        .clone()
        .unwrap_or_else(|| value.clone());
    let same_file = !raw.is_empty() && resolve_path(ctx.path_index, &raw).is_some();
    let condition = own_condition(&reference.suffixes, ctx);
    let mut meta = Vec::new();
    let has_context = reference.instance && !reference.context_paths.is_empty();
    if has_context {
        meta.push(context_part(&reference.context_paths));
    }
    meta.extend(suffix_parts(&reference.suffixes, condition.as_ref()));
    let row = Row {
        id: ctx.index.id_of(reference.range).unwrap_or("").to_string(),
        kind: "reference".to_string(),
        level,
        parent_id,
        subtree_size: 0,
        posinset,
        setsize,
        has_children: false,
        label: reference.name.clone(),
        definition_ref: reference.definition_ref.clone(),
        value: Some(value.clone()),
        shown_value: Some(value.clone()),
        target: Some(raw),
        followable: Some(same_file),
        context_paths: if has_context {
            Some(reference.context_paths.clone())
        } else {
            None
        },
        title: reference.definition_ref.clone(),
        haystack: haystack(&reference.name, None, Some(&value), &meta),
        meta: meta.clone(),
        comments: comment_lines(&meta),
        ..Default::default()
    };
    append_row(rows, row, condition, disabled_by_ancestor);
}

fn append_row(
    rows: &mut Vec<Row>,
    mut row: Row,
    condition: Option<RowCondition>,
    disabled_by_ancestor: bool,
) -> bool {
    let own_false = condition
        .as_ref()
        .map(|c| c.state == ConditionState::False)
        .unwrap_or(false);
    let disabled = disabled_by_ancestor || own_false;
    if let Some(condition) = condition {
        row.condition = Some(condition);
    }
    if disabled {
        row.disabled = Some(true);
        row.disabled_by = Some(if own_false { "self" } else { "ancestor" }.to_string());
    } else if row.condition.is_some() {
        row.disabled = Some(false);
    }
    rows.push(row);
    disabled
}

fn own_condition(node: &Suffixes, ctx: &BuildContext) -> Option<RowCondition> {
    let text = node.syscond.as_ref()?;
    let result = evaluate_syscond(text, &ctx.conditions);
    Some(row_condition(text, result))
}

fn row_condition(text: &str, result: ConditionResult) -> RowCondition {
    let missing_text = if result.missing.is_empty() {
        None
    } else {
        Some(format!("missing: {}", result.missing.join(", ")))
    };
    RowCondition {
        text: text.to_string(),
        state: result.state,
        reason: result.error.or(missing_text),
        missing: result.missing,
        symbols: result.symbols,
        values: result.values,
    }
}

fn short_part(short_name: &str) -> MetaPart {
    MetaPart {
        cls: "short".to_string(),
        text: format!("\"{short_name}\""),
        title: short_name.to_string(),
        state: None,
    }
}

fn variant_part(variant: &str) -> MetaPart {
    let text = camelize(variant);
    MetaPart {
        cls: "variant".to_string(),
        text: format!("({text})"),
        title: text,
        state: None,
    }
}

fn context_part(context_paths: &[String]) -> MetaPart {
    let text = format!("context {}", context_paths.join(", "));
    MetaPart {
        cls: "context".to_string(),
        text: text.clone(),
        title: text,
        state: None,
    }
}

fn suffix_parts(node: &Suffixes, condition: Option<&RowCondition>) -> Vec<MetaPart> {
    let mut parts = Vec::new();
    if let Some(syscond) = &node.syscond {
        let text = format!("[{syscond}]");
        let title = condition
            .map(condition_tooltip)
            .unwrap_or_else(|| text.clone());
        parts.push(MetaPart {
            cls: "condition".to_string(),
            text,
            title,
            state: condition.map(|c| c.state),
        });
    }
    if let Some(variants) = &node.post_build_variants {
        if !variants.is_empty() {
            let text = variants
                .iter()
                .map(|variant| {
                    format!(
                        "{} {} {}",
                        variant.criterion, variant.operator, variant.value
                    )
                })
                .collect::<Vec<_>>()
                .join(" && ");
            parts.push(MetaPart {
                cls: "condition".to_string(),
                text: format!("<{text}>"),
                title: format!("<{text}>"),
                state: None,
            });
        }
    }
    for annotation in node.annotations.as_deref().unwrap_or(&[]) {
        if let Some(part) = annotation_part(annotation) {
            parts.push(part);
        }
    }
    parts
}

fn annotation_part(annotation: &Annotation) -> Option<MetaPart> {
    let label = annotation
        .label
        .as_ref()
        .filter(|label| !label.is_empty())
        .map(|label| format!("[{label}] "))
        .unwrap_or_default();
    let text = annotation.text.clone().unwrap_or_default();
    let text = label + &text;
    if text.is_empty() {
        return None;
    }
    Some(MetaPart {
        cls: "annotation".to_string(),
        text: text.clone(),
        title: text,
        state: None,
    })
}

fn comment_lines(meta: &[MetaPart]) -> Option<Vec<String>> {
    let lines: Vec<String> = meta
        .iter()
        .filter(|part| part.cls == "annotation")
        .map(|part| part.text.clone())
        .collect();
    if lines.is_empty() {
        None
    } else {
        Some(lines)
    }
}

fn condition_tooltip(condition: &RowCondition) -> String {
    let mut lines: Vec<String> = condition
        .symbols
        .iter()
        .map(|name| {
            let value = condition.values.get(name);
            let rendered = match value {
                None => "(not set)".to_string(),
                Some(ConditionValue::Str(text)) => format!("\"{text}\""),
                Some(ConditionValue::Num(number)) => format_number(*number),
                Some(ConditionValue::Bool(flag)) => flag.to_string(),
            };
            format!("{name} = {rendered}")
        })
        .collect();
    let reason = if condition.state == ConditionState::Unknown {
        condition
            .reason
            .as_ref()
            .filter(|reason| !reason.starts_with("missing:"))
    } else {
        None
    };
    if lines.is_empty() {
        return reason.cloned().unwrap_or_else(|| condition.text.clone());
    }
    if let Some(reason) = reason {
        lines.push(reason.clone());
    }
    lines.join("\n")
}

fn haystack(
    label: &str,
    short_name: Option<&str>,
    value: Option<&str>,
    meta: &[MetaPart],
) -> String {
    let mut parts: Vec<&str> = vec![label, short_name.unwrap_or(""), value.unwrap_or("")];
    for part in meta {
        parts.push(&part.text);
    }
    parts
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn format_number(number: f64) -> String {
    if number.fract() == 0.0 && number.abs() < 1e21 {
        format!("{}", number as i64)
    } else {
        format!("{number}")
    }
}

fn parameter_value_kind(parameter: &ParameterNode, value: &str) -> &'static str {
    value_kind_of(parameter.numeric, value)
}

fn value_kind_of(numeric: bool, value: &str) -> &'static str {
    if !numeric {
        return "textual";
    }
    if value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("false") {
        return "boolean";
    }
    "numeric"
}

/// Rewrites the value-derived fields of a parameter row after an in-place value edit.
pub fn refresh_value_row(row: &mut Row, definition_dest: Option<&str>, numeric: bool, value: &str) {
    let kind = value_kind_of(numeric, value);
    let parameter_type = parameter_type(definition_dest, kind);
    row.value = Some(value.to_string());
    row.shown_value = Some(if numeric {
        value.to_string()
    } else {
        format!("\"{value}\"")
    });
    row.value_kind = Some(kind.to_string());
    row.formats = Some(parameter_formats(value, &parameter_type));
    row.parameter_type = Some(parameter_type);
    row.haystack = haystack(&row.label, None, Some(value), &row.meta);
}

fn parameter_type(definition_dest: Option<&str>, value_kind: &str) -> String {
    if let Some(dest) = definition_dest {
        if let Some((_, mapped)) = PARAMETER_TYPES.iter().find(|(name, _)| *name == dest) {
            return (*mapped).to_string();
        }
        if let Some(derived) = derived_type(dest) {
            return derived.to_string();
        }
    }
    match value_kind {
        "boolean" => "Boolean",
        "numeric" => "Numeric",
        "textual" => "Textual",
        _ => "Unknown",
    }
    .to_string()
}

fn derived_type(definition_dest: &str) -> Option<&'static str> {
    // `ECUC-ONE-OFF-PARAM-DEF` -> `One off`. The result is interned by the caller's
    // lifetime; a leaked value is created at most once per distinct DEST.
    if !definition_dest.starts_with("ECUC-") || !definition_dest.ends_with("-PARAM-DEF") {
        return None;
    }
    let middle = definition_dest[5..definition_dest.len() - 10]
        .to_lowercase()
        .replace('-', " ");
    if middle.is_empty() {
        return None;
    }
    let mut chars = middle.chars();
    let first = chars.next()?.to_uppercase().to_string();
    Some(Box::leak(
        format!("{first}{}", chars.as_str()).into_boxed_str(),
    ))
}

fn parameter_formats(value: &str, parameter_type: &str) -> Vec<ParameterFormat> {
    if UNFORMATTED_TYPES.contains(&parameter_type) {
        return Vec::new();
    }
    let raw = value.trim();
    if raw.is_empty() {
        return Vec::new();
    }
    if parameter_type == "Float" {
        return vec![ParameterFormat {
            label: "Decimal".to_string(),
            value: raw.to_string(),
        }];
    }
    match ecuc_integer_value(value) {
        Some(integer) => integer_formats(integer),
        None if parameter_type == "Numeric" => {
            vec![ParameterFormat {
                label: "Decimal".to_string(),
                value: raw.to_string(),
            }]
        }
        None => Vec::new(),
    }
}

/// Parses a decimal, `0x` or `0b` integer literal with a sign; `i128` holds AUTOSAR's 64-bit range.
fn ecuc_integer_value(value: &str) -> Option<i128> {
    let raw = value.trim();
    if raw.is_empty() {
        return None;
    }
    let (sign, body) = match raw.as_bytes().first() {
        Some(b'-') => (-1i128, &raw[1..]),
        Some(b'+') => (1i128, &raw[1..]),
        _ => (1i128, raw),
    };
    let parsed = if let Some(hex) = body.strip_prefix("0x").or_else(|| body.strip_prefix("0X")) {
        i128::from_str_radix(hex, 16).ok()?
    } else if let Some(binary) = body.strip_prefix("0b").or_else(|| body.strip_prefix("0B")) {
        i128::from_str_radix(binary, 2).ok()?
    } else if !body.is_empty() && body.bytes().all(|b| b.is_ascii_digit()) {
        body.parse::<i128>().ok()?
    } else {
        return None;
    };
    Some(sign * parsed)
}

fn integer_formats(integer: i128) -> Vec<ParameterFormat> {
    let sign = if integer < 0 { "-" } else { "" };
    let magnitude = integer.unsigned_abs();
    vec![
        ParameterFormat {
            label: "Decimal".to_string(),
            value: integer.to_string(),
        },
        ParameterFormat {
            label: "Hexadecimal".to_string(),
            value: format!("{sign}0x{:02X}", magnitude),
        },
        ParameterFormat {
            label: "Binary".to_string(),
            value: format!("{sign}0b{:08b}", magnitude),
        },
    ]
}

/// `/A/B/C` -> `A.B.C`, the legacy `structify`.
fn dotted(path: &str) -> String {
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() <= 1 {
        return path.to_string();
    }
    parts[1..].join(".")
}

/// `VARIANT-PRE-COMPILE` -> `VariantPreCompile`, the legacy `camelize`.
fn camelize(value: &str) -> String {
    value
        .split('-')
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().to_string() + &chars.as_str().to_lowercase(),
                None => String::new(),
            }
        })
        .collect()
}
