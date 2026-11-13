//! Value validation and XML escaping.
//!
//! Refusals return a reason and mutate nothing; an unchanged value is refused so
//! idling cannot dirty the document. A port of `core/ecuc/validate.ts`, refusal
//! strings included.

use super::model::ParameterNode;
use super::text::escape_xml;

pub struct ValidationOk {
    pub text: String,
}

pub type ValidationResult = Result<ValidationOk, String>;

fn is_boolean(input: &str) -> bool {
    input == "true" || input == "false"
}

fn is_decimal_integer(input: &str) -> bool {
    let body = input.strip_prefix('-').unwrap_or(input);
    !body.is_empty() && body.bytes().all(|b| b.is_ascii_digit())
}

fn is_hexadecimal(input: &str) -> bool {
    let Some(rest) = input
        .strip_prefix("0x")
        .or_else(|| input.strip_prefix("0X"))
    else {
        return false;
    };
    !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_binary(input: &str) -> bool {
    let Some(rest) = input
        .strip_prefix("0b")
        .or_else(|| input.strip_prefix("0B"))
    else {
        return false;
    };
    !rest.is_empty() && rest.bytes().all(|b| b == b'0' || b == b'1')
}

/// `-?\d+\.\d+([eE][+-]?\d+)?`
fn is_decimal_fraction(input: &str) -> bool {
    let body = input.strip_prefix('-').unwrap_or(input);
    let Some((integer, fraction)) = body.split_once('.') else {
        return false;
    };
    if integer.is_empty() || !integer.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    let fraction = match fraction.find(['e', 'E']) {
        Some(index) => {
            let (digits, exponent) = fraction.split_at(index);
            let exponent = &exponent[1..];
            let exponent_body = exponent.strip_prefix(['+', '-']).unwrap_or(exponent);
            if exponent_body.is_empty() || !exponent_body.bytes().all(|b| b.is_ascii_digit()) {
                return false;
            }
            digits
        }
        None => fraction,
    };
    !fraction.is_empty() && fraction.bytes().all(|b| b.is_ascii_digit())
}

/// `-?(?:\d+|0[xX][0-9A-Fa-f]+|0[bB][01]+)`
fn is_integer_literal(input: &str) -> bool {
    let body = input.strip_prefix('-').unwrap_or(input);
    is_decimal_integer(body) || is_hexadecimal(body) || is_binary(body)
}

/// `-?(?:\d+|\d+\.\d+(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)`
fn is_float_literal(input: &str) -> bool {
    let body = input.strip_prefix('-').unwrap_or(input);
    if is_decimal_integer(body) {
        return true;
    }
    if let Some((integer, fraction)) = body.split_once('.') {
        return is_decimal_integer(integer) && is_decimal_fraction(body) && !fraction.is_empty();
    }
    let Some(index) = body.find(['e', 'E']) else {
        return false;
    };
    let (integer, exponent) = body.split_at(index);
    let exponent = &exponent[1..];
    let exponent_body = exponent.strip_prefix(['+', '-']).unwrap_or(exponent);
    is_decimal_integer(integer)
        && !exponent_body.is_empty()
        && exponent_body.bytes().all(|b| b.is_ascii_digit())
}

/// A letter or `_`, then letters, digits and `_`.
fn is_short_name(input: &str) -> bool {
    let mut bytes = input.bytes();
    match bytes.next() {
        Some(first) if first.is_ascii_alphabetic() || first == b'_' => {}
        _ => return false,
    }
    bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// An absolute `/`-separated path with no empty segment.
fn is_absolute_path(input: &str) -> bool {
    let Some(rest) = input.strip_prefix('/') else {
        return false;
    };
    if rest.is_empty() {
        return false;
    }
    rest.split('/').all(|segment| {
        !segment.is_empty()
            && !segment
                .chars()
                .any(|ch| ch.is_whitespace() || matches!(ch, '/' | '<' | '>' | '"' | '\'' | '&'))
    })
}

/// XML 1.0 legal characters; anything else cannot be represented even escaped.
fn xml_refusal(input: &str, subject: &str) -> Option<String> {
    let illegal = input.chars().any(|ch| {
        let code = ch as u32;
        !(code == 0x9
            || code == 0xA
            || code == 0xD
            || (0x20..=0xD7FF).contains(&code)
            || (0xE000..=0xFFFD).contains(&code)
            || (0x10000..=0x10FFFF).contains(&code))
    });
    illegal.then(|| format!("{subject} contains a character XML cannot represent"))
}

fn value_or_refusal(parameter: &ParameterNode, input: &str) -> ValidationResult {
    if let Some(reason) = xml_refusal(input, "the value") {
        return Err(reason);
    }
    if input == parameter.display_value.as_deref().unwrap_or("") {
        return Err("the value is unchanged".to_string());
    }
    Ok(ValidationOk {
        text: escape_xml(input),
    })
}

fn typed_refusal(parameter: &ParameterNode, input: &str) -> Option<String> {
    match parameter.definition_dest.as_deref() {
        Some("ECUC-BOOLEAN-PARAM-DEF") if !is_boolean(input) => Some(format!(
            "\"{input}\" is not a boolean value (true or false)"
        )),
        Some("ECUC-INTEGER-PARAM-DEF") if !is_integer_literal(input) => Some(format!(
            "\"{input}\" is not an integer (decimal, hexadecimal or binary)"
        )),
        Some("ECUC-FLOAT-PARAM-DEF") if !is_float_literal(input) => Some(format!(
            "\"{input}\" is not a decimal or floating-point value"
        )),
        _ => None,
    }
}

fn has_typed_dest(definition_dest: Option<&str>) -> bool {
    matches!(
        definition_dest,
        Some("ECUC-BOOLEAN-PARAM-DEF")
            | Some("ECUC-INTEGER-PARAM-DEF")
            | Some("ECUC-FLOAT-PARAM-DEF")
    )
}

fn untyped_refusal(parameter: &ParameterNode, input: &str) -> Option<String> {
    if has_typed_dest(parameter.definition_dest.as_deref()) || !parameter.numeric {
        return None;
    }
    if is_boolean(input) || is_integer_literal(input) || is_decimal_fraction(input) {
        return None;
    }
    Some(format!(
        "\"{input}\" is not a valid numerical value (true, false, integer, hexadecimal or decimal fraction)"
    ))
}

/// Validates `input` for parameter `parameter` and returns the escaped text to write.
pub fn validate_value(parameter: &ParameterNode, input: &str) -> ValidationResult {
    if let Some(reason) = typed_refusal(parameter, input) {
        return Err(reason);
    }
    if let Some(reason) = untyped_refusal(parameter, input) {
        return Err(reason);
    }
    value_or_refusal(parameter, input)
}

/// Validates `input` as a container's `SHORT-NAME` text.
pub fn validate_short_name(input: &str) -> ValidationResult {
    if input.is_empty() {
        return Err("the short name is empty".to_string());
    }
    if let Some(reason) = xml_refusal(input, "the short name") {
        return Err(reason);
    }
    if !is_short_name(input) {
        return Err(format!(
            "\"{input}\" is not a valid short name (letters, digits and underscores, not starting with a digit)"
        ));
    }
    Ok(ValidationOk {
        text: escape_xml(input),
    })
}

/// Validates `input` as a container's `DEFINITION-REF` text.
pub fn validate_definition_ref(input: &str) -> ValidationResult {
    if input.is_empty() {
        return Err("the definition reference is empty".to_string());
    }
    if let Some(reason) = xml_refusal(input, "the definition reference") {
        return Err(reason);
    }
    if !is_absolute_path(input) {
        return Err(format!(
            "\"{input}\" is not a valid definition reference path (an absolute /-separated path)"
        ));
    }
    Ok(ValidationOk {
        text: escape_xml(input),
    })
}
