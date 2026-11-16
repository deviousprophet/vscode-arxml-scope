//! Find and replace over the engine's row and diff documents.
//!
//! The page owns the widget; this module owns the match semantics. It searches the
//! same fields the row renderer shows (label, value, meta chips), applies case,
//! whole-word and regex options, and plans validated edits for replaceable fields.
//! Offsets are UTF-16 code units, the unit the page highlights and the planner
//! edits.

use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

use super::diff::{DiffCell, DiffDocument, DiffRow, DiffStatus};
use super::ecuc::{edit, Document, Row};

pub const MAX_SEARCH_MATCHES: usize = 20_000;
pub const MAX_REPLACE_FIELDS: usize = 500;

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
}

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchField {
    Label,
    Value,
    Meta,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub row_id: String,
    pub field: SearchField,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part: Option<usize>,
    pub start: usize,
    pub end: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_start: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_end: Option<usize>,
    pub replaceable: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    pub total: usize,
    pub limited: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSearchMatch {
    pub key: String,
    pub side: DiffSide,
    pub field: SearchField,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part: Option<usize>,
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffSide {
    Left,
    Right,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSearchResult {
    pub matches: Vec<DiffSearchMatch>,
    pub total: usize,
    pub limited: bool,
}

/// A user-correctable search failure: the pattern does not compile.
#[derive(Clone, Debug)]
pub struct SearchError {
    pub message: String,
}

impl SearchError {
    fn invalid_pattern(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

struct Matcher {
    regex: Regex,
    whole_word: bool,
}

impl Matcher {
    fn compile(query: &str, options: &SearchOptions) -> Result<Self, SearchError> {
        let source = if options.regex {
            query.to_string()
        } else {
            regex::escape(query)
        };
        let regex = RegexBuilder::new(&source)
            .case_insensitive(!options.case_sensitive)
            .build()
            .map_err(|error| SearchError::invalid_pattern(error.to_string()))?;
        Ok(Self {
            regex,
            whole_word: options.whole_word,
        })
    }

    /// Non-overlapping matches as UTF-16 offsets.
    fn ranges(&self, text: &str) -> Vec<(usize, usize)> {
        let mut out = Vec::new();
        for found in self.regex.find_iter(text) {
            if found.start() == found.end() {
                continue;
            }
            if self.whole_word && !word_boundaries(text, found.start(), found.end()) {
                continue;
            }
            out.push((
                text[..found.start()].encode_utf16().count(),
                text[..found.end()].encode_utf16().count(),
            ));
        }
        out
    }
}

fn is_word_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

/// True when neither side of the match touches an ASCII word character.
fn word_boundaries(text: &str, start: usize, end: usize) -> bool {
    let before = text[..start].chars().next_back();
    let after = text[end..].chars().next();
    !before.is_some_and(is_word_char) && !after.is_some_and(is_word_char)
}

/// The text a row shows for a value, and how a display offset maps to raw text.
fn value_text(row: &Row) -> (&str, Option<isize>) {
    let shown = row
        .shown_value
        .as_deref()
        .or(row.value.as_deref())
        .unwrap_or("");
    let raw = row.value.as_deref().unwrap_or("");
    if row.kind != "parameter" || raw.is_empty() {
        return (shown, None);
    }
    if shown == raw {
        return (shown, Some(0));
    }
    let quoted = shown.len() == raw.len() + 2
        && shown.starts_with('"')
        && shown.ends_with('"')
        && &shown[1..shown.len() - 1] == raw;
    (shown, quoted.then_some(-1))
}

fn push_field_matches(
    out: &mut Vec<SearchMatch>,
    row: &Row,
    field: SearchField,
    part: Option<usize>,
    text: &str,
    matcher: &Matcher,
    raw_shift: Option<isize>,
) -> bool {
    for (start, end) in matcher.ranges(text) {
        if out.len() >= MAX_SEARCH_MATCHES {
            return false;
        }
        let shift = raw_shift.and_then(|shift| {
            let raw_start = (start as isize).checked_add(shift)?;
            let raw_end = (end as isize).checked_add(shift)?;
            Some((raw_start as usize, raw_end as usize))
        });
        out.push(SearchMatch {
            row_id: row.id.clone(),
            field,
            part,
            start,
            end,
            raw_start: shift.map(|(value, _)| value),
            raw_end: shift.map(|(_, value)| value),
            replaceable: shift.is_some(),
        });
    }
    true
}

/// Finds every occurrence in the row fields the page renders.
pub fn search_rows(
    rows: &[Row],
    query: &str,
    options: &SearchOptions,
) -> Result<SearchResult, SearchError> {
    let trimmed = if options.regex { query } else { query.trim() };
    if trimmed.is_empty() {
        return Ok(SearchResult {
            matches: Vec::new(),
            total: 0,
            limited: false,
        });
    }
    let matcher = Matcher::compile(trimmed, options)?;
    let mut matches = Vec::new();
    let mut limited = false;
    'rows: for row in rows {
        let (value, value_shift) = value_text(row);
        let label_shift = if row.kind == "container"
            && row
                .short_name
                .as_deref()
                .is_some_and(|name| name.starts_with(row.label.as_str()))
        {
            Some(0)
        } else {
            None
        };
        if !push_field_matches(
            &mut matches,
            row,
            SearchField::Label,
            None,
            &row.label,
            &matcher,
            label_shift,
        ) {
            limited = true;
            break 'rows;
        }
        if !push_field_matches(
            &mut matches,
            row,
            SearchField::Value,
            None,
            value,
            &matcher,
            value_shift,
        ) {
            limited = true;
            break 'rows;
        }
        for (index, part) in row.meta.iter().enumerate() {
            if !push_field_matches(
                &mut matches,
                row,
                SearchField::Meta,
                Some(index),
                &part.text,
                &matcher,
                None,
            ) {
                limited = true;
                break 'rows;
            }
        }
    }
    let total = matches.len();
    Ok(SearchResult {
        matches,
        total,
        limited,
    })
}

fn diff_cell_fields(cell: &DiffCell) -> Vec<(SearchField, Option<usize>, &str)> {
    let value = cell.shown_value.as_deref().or(cell.value.as_deref());
    let mut fields = vec![(SearchField::Label, None, cell.label.as_str())];
    if let Some(value) = value {
        fields.push((SearchField::Value, None, value));
    }
    for (index, part) in cell.meta.iter().enumerate() {
        fields.push((SearchField::Meta, Some(index), part.text.as_str()));
    }
    fields
}

fn search_row_side(
    row: &DiffRow,
    side: DiffSide,
    cell: &DiffCell,
    matcher: &Matcher,
    out: &mut Vec<DiffSearchMatch>,
) -> bool {
    for (field, part, text) in diff_cell_fields(cell) {
        for (start, end) in matcher.ranges(text) {
            if out.len() >= MAX_SEARCH_MATCHES {
                return false;
            }
            out.push(DiffSearchMatch {
                key: row.key.clone(),
                side,
                field,
                part,
                start,
                end,
            });
        }
    }
    true
}

/// Finds every occurrence in the diff rows, optionally skipping unchanged rows.
pub fn search_diff(
    document: &DiffDocument,
    query: &str,
    options: &SearchOptions,
    changes_only: bool,
) -> Result<DiffSearchResult, SearchError> {
    let matcher = Matcher::compile(query, options)?;
    let mut matches = Vec::new();
    let mut limited = false;
    'rows: for row in &document.rows {
        if changes_only && row.status == DiffStatus::Unchanged {
            continue;
        }
        if let Some(cell) = row.left.as_ref() {
            if !search_row_side(row, DiffSide::Left, cell, &matcher, &mut matches) {
                limited = true;
                break 'rows;
            }
        }
        if let Some(cell) = row.right.as_ref() {
            if !search_row_side(row, DiffSide::Right, cell, &matcher, &mut matches) {
                limited = true;
                break 'rows;
            }
        }
    }
    let total = matches.len();
    Ok(DiffSearchResult {
        matches,
        total,
        limited,
    })
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceMatch {
    pub row_id: String,
    pub field: SearchField,
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReplaceRequest {
    pub query: String,
    pub options: SearchOptions,
    pub replacement: String,
    pub preserve_case: bool,
    pub all: bool,
    #[serde(rename = "match")]
    pub selected: Option<ReplaceMatch>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacePlan {
    pub record: edit::EditRecord,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_node_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
    pub ok: bool,
    pub plans: Vec<ReplacePlan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub replaced_fields: usize,
    pub replaced_occurrences: usize,
    pub stopped: bool,
}

impl ReplaceResult {
    fn refusal(reason: impl Into<String>) -> Self {
        Self {
            ok: false,
            plans: Vec::new(),
            reason: Some(reason.into()),
            replaced_fields: 0,
            replaced_occurrences: 0,
            stopped: false,
        }
    }
}

/// One field's selected occurrences, before planning.
struct FieldChange {
    row_id: String,
    field: SearchField,
    occurrences: Vec<(usize, usize)>,
    raw: String,
}

fn case_style(text: &str) -> Option<u8> {
    if text.is_empty() {
        return None;
    }
    let upper = text.to_uppercase();
    let lower = text.to_lowercase();
    if text == upper && text != lower {
        return Some(1);
    }
    if text == lower && text != upper {
        return Some(2);
    }
    let mut chars = text.chars();
    let first = chars.next()?;
    if first.is_uppercase() && chars.all(|ch| !ch.is_uppercase()) {
        return Some(3);
    }
    None
}

fn apply_case(replacement: &str, matched: &str) -> String {
    match case_style(matched) {
        Some(1) => replacement.to_uppercase(),
        Some(2) => replacement.to_lowercase(),
        Some(3) => {
            let lower = replacement.to_lowercase();
            let mut chars = lower.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        }
        _ => replacement.to_string(),
    }
}

/// Replaces the selected UTF-16 spans in one field text.
fn replace_in_text(
    text: &str,
    occurrences: &[(usize, usize)],
    replacement: &str,
    preserve_case: bool,
) -> String {
    let source = super::ecuc::SourceText::new(text.to_string());
    let mut out = String::with_capacity(text.len());
    let mut at = 0usize;
    for (start, end) in occurrences {
        if *start < at || *end > source.len_utf16() {
            continue;
        }
        out.push_str(source.slice_utf16(at, *start));
        let matched = source.slice_utf16(*start, *end);
        out.push_str(&if preserve_case {
            apply_case(replacement, matched)
        } else {
            replacement.to_string()
        });
        at = *end;
    }
    out.push_str(source.slice_utf16(at, source.len_utf16()));
    out
}

fn field_raw(row: &Row, field: SearchField) -> Option<&str> {
    match field {
        SearchField::Label => row.short_name.as_deref(),
        SearchField::Value => row.value.as_deref(),
        SearchField::Meta => None,
    }
}

fn plan_field(
    document: &Document,
    change: &FieldChange,
    replacement: &str,
    preserve_case: bool,
) -> Result<ReplacePlan, String> {
    let new_text = replace_in_text(&change.raw, &change.occurrences, replacement, preserve_case);
    let plan = match change.field {
        SearchField::Label => edit::plan_field_edit(
            document.model(),
            document.index(),
            document.text(),
            &change.row_id,
            "shortName",
            &new_text,
        ),
        SearchField::Value => edit::plan_value_edit(
            document.model(),
            document.index(),
            document.text(),
            &change.row_id,
            &new_text,
        ),
        SearchField::Meta => return Err("this match is search-only".to_string()),
    };
    if !plan.ok {
        return Err(plan
            .reason
            .unwrap_or_else(|| "the field cannot be replaced".to_string()));
    }
    Ok(ReplacePlan {
        record: plan.record.expect("an accepted plan has a record"),
        next_node_id: plan.next_node_id,
    })
}

/// Plans one or every replaceable field, atomically.
pub fn plan_replace(document: &Document, request: &ReplaceRequest) -> ReplaceResult {
    let search = match search_rows(document.rows(), &request.query, &request.options) {
        Ok(result) => result,
        Err(error) => return ReplaceResult::refusal(error.message),
    };
    let rows: std::collections::HashMap<&str, &Row> = document
        .rows()
        .iter()
        .map(|row| (row.id.as_str(), row))
        .collect();
    let mut changes: Vec<FieldChange> = Vec::new();
    let mut seen: std::collections::HashSet<(String, SearchField)> =
        std::collections::HashSet::new();
    let mut occurrences = 0usize;
    let mut stopped = false;
    for found in &search.matches {
        if !found.replaceable {
            continue;
        }
        let Some(row) = rows.get(found.row_id.as_str()) else {
            continue;
        };
        let Some(raw) = field_raw(row, found.field) else {
            continue;
        };
        let Some(raw_start) = found.raw_start else {
            continue;
        };
        let Some(raw_end) = found.raw_end else {
            continue;
        };
        let wanted = match &request.selected {
            Some(selected) => {
                request.all
                    || (selected.row_id == found.row_id
                        && selected.field == found.field
                        && selected.start == found.start
                        && selected.end == found.end)
            }
            None => request.all,
        };
        if !wanted {
            continue;
        }
        if !request.all && !changes.is_empty() {
            break;
        }
        let key = (found.row_id.clone(), found.field);
        if seen.insert(key) {
            if changes.len() >= MAX_REPLACE_FIELDS {
                stopped = true;
                break;
            }
            changes.push(FieldChange {
                row_id: found.row_id.clone(),
                field: found.field,
                occurrences: Vec::new(),
                raw: raw.to_string(),
            });
        }
        if let Some(change) = changes
            .iter_mut()
            .find(|change| change.row_id == found.row_id && change.field == found.field)
        {
            if !change.occurrences.contains(&(raw_start, raw_end)) {
                change.occurrences.push((raw_start, raw_end));
                occurrences += 1;
            }
        }
        if request.selected.is_some() && !request.all {
            break;
        }
    }
    if changes.is_empty() {
        return ReplaceResult::refusal(
            "no replaceable match here; values and container short names can be replaced",
        );
    }
    let mut plans = Vec::with_capacity(changes.len());
    for change in &changes {
        let mut change = FieldChange {
            row_id: change.row_id.clone(),
            field: change.field,
            occurrences: change.occurrences.clone(),
            raw: change.raw.clone(),
        };
        change.occurrences.sort_by_key(|(start, _)| *start);
        match plan_field(
            document,
            &change,
            &request.replacement,
            request.preserve_case,
        ) {
            Ok(plan) => plans.push(plan),
            Err(reason) => return ReplaceResult::refusal(reason),
        }
    }
    ReplaceResult {
        ok: true,
        replaced_fields: plans.len(),
        plans,
        reason: None,
        replaced_occurrences: occurrences,
        stopped,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ecuc::Document;

    fn document() -> Document {
        Document::new(
            r#"<AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/M</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>AlphaContainer</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/M/Alpha</DEFINITION-REF><PARAMETER-VALUES><ECUC-TEXTUAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-STRING-PARAM-DEF">/P/M/C/Name</DEFINITION-REF><VALUE>alpha one ALPHA</VALUE></ECUC-TEXTUAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>"#
                .to_string(),
        )
    }

    fn run(query: &str, options: SearchOptions) -> SearchResult {
        search_rows(document().rows(), query, &options).expect("valid pattern")
    }

    #[test]
    fn is_case_insensitive_by_default() {
        let result = run("alpha", SearchOptions::default());
        assert!(result.matches.len() >= 3);
    }

    #[test]
    fn case_sensitive_narrows_the_matches() {
        let result = run(
            "ALPHA",
            SearchOptions {
                case_sensitive: true,
                ..SearchOptions::default()
            },
        );
        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].field, SearchField::Value);
    }

    #[test]
    fn whole_word_rejects_partial_words() {
        let result = run(
            "alpha",
            SearchOptions {
                whole_word: true,
                ..SearchOptions::default()
            },
        );
        assert_eq!(result.matches.len(), 3);
    }

    #[test]
    fn regex_uses_the_pattern_and_reports_invalid_patterns() {
        let result = run(
            "Al.*Container",
            SearchOptions {
                regex: true,
                ..SearchOptions::default()
            },
        );
        assert_eq!(result.matches.len(), 1);
        assert!(result.matches.iter().all(|found| found.start <= found.end));
        let error = search_rows(
            document().rows(),
            "(",
            &SearchOptions {
                regex: true,
                ..SearchOptions::default()
            },
        );
        assert!(error.is_err());
    }

    #[test]
    fn value_matches_are_replaceable_and_meta_are_not() {
        let result = run("alpha", SearchOptions::default());
        assert!(result
            .matches
            .iter()
            .any(|found| found.field == SearchField::Value && found.replaceable));
        assert!(result
            .matches
            .iter()
            .filter(|found| found.field == SearchField::Meta)
            .all(|found| !found.replaceable));
    }

    #[test]
    fn replace_one_field_preserves_case() {
        let document = document();
        let result = plan_replace(
            &document,
            &ReplaceRequest {
                query: "alpha".into(),
                replacement: "beta".into(),
                preserve_case: true,
                all: true,
                ..ReplaceRequest::default()
            },
        );
        assert!(result.ok, "{}", result.reason.unwrap_or_default());
        assert_eq!(result.plans.len(), 2, "value and short name");
        let value = result
            .plans
            .iter()
            .find(|plan| plan.record.new_text.contains("beta"))
            .expect("the value plan");
        assert!(value.record.new_text.contains("beta one BETA"));
    }

    #[test]
    fn invalid_replacement_refuses_without_plans() {
        let document = document();
        let result = plan_replace(
            &document,
            &ReplaceRequest {
                query: "AlphaContainer".into(),
                replacement: "Not A Name!".into(),
                all: true,
                ..ReplaceRequest::default()
            },
        );
        assert!(!result.ok);
        assert!(result.plans.is_empty());
    }

    #[test]
    fn diff_search_covers_both_sides_and_changes_only() {
        let left = document();
        let right = Document::new(left.text().as_str().replace(
            "<SHORT-NAME>AlphaContainer</SHORT-NAME>",
            "<SHORT-NAME>BetaContainer</SHORT-NAME>",
        ));
        let document = super::super::diff::build_diff_document(
            super::super::diff::DiffSide {
                label: super::super::diff::FileLabel {
                    name: "left".into(),
                    path: "left".into(),
                },
                header: Default::default(),
                rows: left.rows(),
                range: &|_| None,
            },
            super::super::diff::DiffSide {
                label: super::super::diff::FileLabel {
                    name: "right".into(),
                    path: "right".into(),
                },
                header: Default::default(),
                rows: right.rows(),
                range: &|_| None,
            },
            &Default::default(),
        );
        let result =
            search_diff(&document, "one", &SearchOptions::default(), false).expect("valid pattern");
        assert!(result
            .matches
            .iter()
            .any(|found| found.side == DiffSide::Left));
        assert!(result
            .matches
            .iter()
            .any(|found| found.side == DiffSide::Right));
        let changed =
            search_diff(&document, "one", &SearchOptions::default(), true).expect("valid pattern");
        assert!(changed.matches.len() <= result.matches.len());
    }
}
