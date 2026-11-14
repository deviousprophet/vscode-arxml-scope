//! SW-SYSCOND expression evaluator.
//!
//! The scanner stores a condition as the joined text of its `SW-SYSCOND` element,
//! with inline `SYSC-REF` elements replaced by their path tail. This module parses
//! that text and evaluates it against supplied system-constant values.
//!
//! Evaluation is three-valued: `true`, `false` or `unknown`. An unresolved
//! identifier, a syntax error or an incomparable pair is `unknown`, which the row
//! builder never treats as "disabled". A port of `core/ecuc/syscond.ts`.

use std::collections::HashMap;

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum ConditionValue {
    Bool(bool),
    Num(f64),
    Str(String),
}

impl ConditionValue {
    fn type_name(&self) -> &'static str {
        match self {
            ConditionValue::Bool(_) => "boolean",
            ConditionValue::Num(_) => "number",
            ConditionValue::Str(_) => "string",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConditionState {
    True,
    False,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConditionResult {
    pub state: ConditionState,
    pub symbols: Vec<String>,
    pub missing: Vec<String>,
    pub values: HashMap<String, ConditionValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BinaryOperator {
    Or,
    And,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Clone, Debug, PartialEq)]
enum Token {
    Number(f64),
    Str(String),
    Bool(bool),
    Identifier(String),
    Operator(Operator),
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Operator {
    Binary(BinaryOperator),
    Not,
}

#[derive(Clone, Debug, PartialEq)]
enum Expression {
    Literal(ConditionValue),
    Identifier(String),
    Not(Box<Expression>),
    Binary(BinaryOperator, Box<Expression>, Box<Expression>),
}

fn is_whitespace(ch: char) -> bool {
    matches!(ch, ' ' | '\t' | '\r' | '\n')
}

fn is_identifier_start(ch: char) -> bool {
    ch.is_ascii_alphabetic() || ch == '_'
}

fn is_identifier_part(ch: char) -> bool {
    is_identifier_start(ch) || ch.is_ascii_digit() || matches!(ch, '.' | '-' | '/')
}

fn char_at(text: &[char], at: usize) -> Option<char> {
    text.get(at).copied()
}

fn starts_number(text: &[char], at: usize) -> bool {
    match char_at(text, at) {
        Some('+' | '-') => starts_unsigned_number(text, at + 1),
        _ => starts_unsigned_number(text, at),
    }
}

fn starts_unsigned_number(text: &[char], at: usize) -> bool {
    match char_at(text, at) {
        Some(ch) if ch.is_ascii_digit() => true,
        Some('.') => char_at(text, at + 1)
            .map(|next| next.is_ascii_digit())
            .unwrap_or(false),
        _ => false,
    }
}

fn scan_decimal_digits(text: &[char], from: usize) -> usize {
    let mut cursor = from;
    while char_at(text, cursor)
        .map(|ch| ch.is_ascii_digit())
        .unwrap_or(false)
    {
        cursor += 1;
    }
    cursor
}

fn scan_hex_digits(text: &[char], from: usize) -> usize {
    let mut cursor = from;
    while char_at(text, cursor)
        .map(|ch| ch.is_ascii_hexdigit())
        .unwrap_or(false)
    {
        cursor += 1;
    }
    cursor
}

fn collect(text: &[char], start: usize, end: usize) -> String {
    text[start.min(text.len())..end.min(text.len())]
        .iter()
        .collect()
}

/// Scans `[+-]?0x…` or `[+-]?(digits[.digits]|.digits)` at `at`.
fn scan_number(text: &[char], at: usize) -> Result<(f64, usize), String> {
    let mut sign = 1.0f64;
    let mut cursor = at;
    if matches!(char_at(text, at), Some('+' | '-')) {
        if char_at(text, at) == Some('-') {
            sign = -1.0;
        }
        cursor += 1;
    }
    let hex =
        char_at(text, cursor) == Some('0') && matches!(char_at(text, cursor + 1), Some('x' | 'X'));
    if hex {
        let digits_start = cursor + 2;
        let end = scan_hex_digits(text, digits_start);
        if end == digits_start {
            return Err(format!("invalid hexadecimal number at {}", at + 1));
        }
        let digits = collect(text, digits_start, end);
        let magnitude = u128::from_str_radix(&digits, 16)
            .map(|v| v as f64)
            .unwrap_or(0.0);
        return Ok((sign * magnitude, end));
    }
    let integer_start = cursor;
    let integer_end = scan_decimal_digits(text, integer_start);
    let fraction = scan_fraction(text, integer_end);
    if integer_end == integer_start && !fraction.1 {
        return Err(format!("invalid number at {}", at + 1));
    }
    let body = collect(text, integer_start, fraction.0);
    let value = body.parse::<f64>().unwrap_or(f64::NAN);
    Ok((sign * value, fraction.0))
}

/// The optional `.digits` part of a decimal literal.
fn scan_fraction(text: &[char], at: usize) -> (usize, bool) {
    if char_at(text, at) != Some('.') {
        return (at, false);
    }
    let end = scan_decimal_digits(text, at + 1);
    (end, end > at + 1)
}

fn unescape_body(body: &str) -> String {
    let mut out = String::with_capacity(body.len());
    let mut chars = body.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(next) = chars.next() {
                out.push(next);
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn scan_string(text: &[char], at: usize) -> Result<(String, usize), String> {
    let quote = char_at(text, at).expect("quote");
    let mut cursor = at + 1;
    while cursor < text.len() {
        if text[cursor] == '\\' {
            cursor += 2;
            continue;
        }
        if text[cursor] == quote {
            return Ok((unescape_body(&collect(text, at + 1, cursor)), cursor + 1));
        }
        cursor += 1;
    }
    Err("unterminated string".to_string())
}

fn tokenize(text: &str) -> Result<Vec<Token>, String> {
    let chars: Vec<char> = text.chars().collect();
    let mut tokens = Vec::new();
    let mut at = 0;
    while at < chars.len() {
        let step = next_token(&chars, at)?;
        if let Some(token) = step.0 {
            tokens.push(token);
        }
        at = step.1;
    }
    Ok(tokens)
}

fn next_token(chars: &[char], at: usize) -> Result<(Option<Token>, usize), String> {
    let ch = chars[at];
    if is_whitespace(ch) {
        return Ok((None, at + 1));
    }
    if ch == '(' {
        return Ok((Some(Token::Left), at + 1));
    }
    if ch == ')' {
        return Ok((Some(Token::Right), at + 1));
    }
    if ch == '"' || ch == '\'' {
        let (value, end) = scan_string(chars, at)?;
        return Ok((Some(Token::Str(value)), end));
    }
    if starts_number(chars, at) {
        let (value, end) = scan_number(chars, at)?;
        return Ok((Some(Token::Number(value)), end));
    }
    let starts_identifier = is_identifier_start(ch)
        || (ch == '/'
            && chars
                .get(at + 1)
                .map(|next| is_identifier_start(*next))
                .unwrap_or(false));
    if starts_identifier {
        let mut end = at + 1;
        while let Some(next) = chars.get(end) {
            if is_identifier_part(*next) {
                end += 1;
            } else {
                break;
            }
        }
        let name = collect(chars, at, end);
        let lower = name.to_lowercase();
        if lower == "true" {
            return Ok((Some(Token::Bool(true)), end));
        }
        if lower == "false" {
            return Ok((Some(Token::Bool(false)), end));
        }
        return Ok((Some(Token::Identifier(name)), end));
    }
    if let Some(two) = two_char_operator(chars, at) {
        return Ok((Some(Token::Operator(Operator::Binary(two.0))), at + 2));
    }
    let single = match ch {
        '!' => Some(Operator::Not),
        '<' => Some(Operator::Binary(BinaryOperator::Lt)),
        '>' => Some(Operator::Binary(BinaryOperator::Gt)),
        _ => None,
    };
    match single {
        Some(operator) => Ok((Some(Token::Operator(operator)), at + 1)),
        None => Err(format!("unexpected character \"{ch}\" at {}", at + 1)),
    }
}

fn two_char_operator(chars: &[char], at: usize) -> Option<(BinaryOperator, usize)> {
    let pair: String = chars[at.min(chars.len())..(at + 2).min(chars.len())]
        .iter()
        .collect();
    let operator = match pair.as_str() {
        "==" => BinaryOperator::Eq,
        "!=" => BinaryOperator::Ne,
        "<=" => BinaryOperator::Le,
        ">=" => BinaryOperator::Ge,
        "&&" => BinaryOperator::And,
        "||" => BinaryOperator::Or,
        _ => return None,
    };
    Some((operator, 2))
}

struct Parser<'a> {
    tokens: &'a [Token],
    at: usize,
    failure: Option<String>,
}

impl<'a> Parser<'a> {
    fn new(tokens: &'a [Token]) -> Self {
        Self {
            tokens,
            at: 0,
            failure: None,
        }
    }

    fn parse(&mut self) -> Option<Expression> {
        let expression = self.parse_or();
        if expression.is_none() || self.failure.is_some() {
            return None;
        }
        if self.at < self.tokens.len() {
            return self.fail("unexpected token after the expression");
        }
        expression
    }

    fn fail(&mut self, message: &str) -> Option<Expression> {
        if self.failure.is_none() {
            self.failure = Some(message.to_string());
        }
        None
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.at)
    }

    fn peek_operator(&self) -> Option<Operator> {
        match self.peek() {
            Some(Token::Operator(operator)) => Some(*operator),
            _ => None,
        }
    }

    fn match_operator(&mut self, operator: BinaryOperator) -> bool {
        if self.peek_operator() == Some(Operator::Binary(operator)) {
            self.at += 1;
            return true;
        }
        false
    }

    fn parse_or(&mut self) -> Option<Expression> {
        let mut left = self.parse_and()?;
        while self.match_operator(BinaryOperator::Or) {
            let right = self.parse_and()?;
            left = Expression::Binary(BinaryOperator::Or, Box::new(left), Box::new(right));
        }
        Some(left)
    }

    fn parse_and(&mut self) -> Option<Expression> {
        let mut left = self.parse_equality()?;
        while self.match_operator(BinaryOperator::And) {
            let right = self.parse_equality()?;
            left = Expression::Binary(BinaryOperator::And, Box::new(left), Box::new(right));
        }
        Some(left)
    }

    fn parse_equality(&mut self) -> Option<Expression> {
        let mut left = self.parse_relational()?;
        loop {
            let operator = match self.peek_operator() {
                Some(Operator::Binary(op))
                    if matches!(op, BinaryOperator::Eq | BinaryOperator::Ne) =>
                {
                    op
                }
                _ => break,
            };
            self.at += 1;
            let right = self.parse_relational()?;
            left = Expression::Binary(operator, Box::new(left), Box::new(right));
        }
        Some(left)
    }

    fn parse_relational(&mut self) -> Option<Expression> {
        let mut left = self.parse_unary()?;
        loop {
            let operator = match self.peek_operator() {
                Some(Operator::Binary(op))
                    if matches!(
                        op,
                        BinaryOperator::Lt
                            | BinaryOperator::Le
                            | BinaryOperator::Gt
                            | BinaryOperator::Ge
                    ) =>
                {
                    op
                }
                _ => break,
            };
            self.at += 1;
            let right = self.parse_unary()?;
            left = Expression::Binary(operator, Box::new(left), Box::new(right));
        }
        Some(left)
    }

    fn parse_unary(&mut self) -> Option<Expression> {
        if self.peek_operator() == Some(Operator::Not) {
            self.at += 1;
            let operand = self.parse_unary()?;
            return Some(Expression::Not(Box::new(operand)));
        }
        self.parse_primary()
    }

    fn parse_primary(&mut self) -> Option<Expression> {
        let Some(token) = self.peek().cloned() else {
            return self.fail("unexpected end of the expression");
        };
        match token {
            Token::Identifier(name) => {
                self.at += 1;
                Some(Expression::Identifier(name))
            }
            Token::Number(value) => {
                self.at += 1;
                Some(Expression::Literal(ConditionValue::Num(value)))
            }
            Token::Str(value) => {
                self.at += 1;
                Some(Expression::Literal(ConditionValue::Str(value)))
            }
            Token::Bool(value) => {
                self.at += 1;
                Some(Expression::Literal(ConditionValue::Bool(value)))
            }
            Token::Left => {
                self.at += 1;
                let inner = self.parse_or()?;
                match self.peek() {
                    Some(Token::Right) => {
                        self.at += 1;
                        Some(inner)
                    }
                    _ => self.fail("missing closing parenthesis"),
                }
            }
            _ => self.fail("unexpected token"),
        }
    }
}

struct EvalState<'a> {
    values: &'a HashMap<String, ConditionValue>,
    symbols: Vec<String>,
    missing: Vec<String>,
    reasons: Vec<String>,
}

fn tail_of(name: &str) -> &str {
    match name.rfind('/') {
        Some(index) => &name[index + 1..],
        None => name,
    }
}

fn tail_matches<'a>(
    values: &'a HashMap<String, ConditionValue>,
    tail: &str,
) -> Vec<&'a ConditionValue> {
    values
        .iter()
        .filter(|(key, _)| tail_of(key) == tail)
        .map(|(_, value)| value)
        .collect()
}

fn resolve_value<'a>(
    values: &'a HashMap<String, ConditionValue>,
    name: &str,
) -> Option<&'a ConditionValue> {
    if let Some(exact) = values.get(name) {
        return Some(exact);
    }
    let tail = tail_of(name);
    if tail != name {
        if let Some(by_tail) = values.get(tail) {
            return Some(by_tail);
        }
    }
    let matches = tail_matches(values, tail);
    if matches.len() == 1 {
        return Some(matches[0]);
    }
    None
}

fn record_symbol(state: &mut EvalState, name: &str) {
    if !state.symbols.iter().any(|symbol| symbol == name) {
        state.symbols.push(name.to_string());
    }
}

fn record_missing(state: &mut EvalState, name: &str) {
    if !state.missing.iter().any(|symbol| symbol == name) {
        state.missing.push(name.to_string());
    }
}

fn lookup<'a>(state: &mut EvalState<'a>, name: &str) -> Option<&'a ConditionValue> {
    record_symbol(state, name);
    let value = resolve_value(state.values, name);
    if value.is_none() {
        record_missing(state, name);
    }
    value
}

fn bool_value(value: &ConditionValue) -> Option<bool> {
    match value {
        ConditionValue::Bool(flag) => Some(*flag),
        _ => None,
    }
}

fn number_value(value: &ConditionValue) -> Option<f64> {
    match value {
        ConditionValue::Num(number) => Some(*number),
        _ => None,
    }
}

fn evaluate<'a>(expression: &Expression, state: &mut EvalState<'a>) -> Option<ConditionValue> {
    match expression {
        Expression::Literal(value) => Some(value.clone()),
        Expression::Identifier(name) => lookup(state, name).cloned(),
        Expression::Not(operand) => {
            let value = evaluate(operand, state)?;
            match bool_value(&value) {
                Some(flag) => Some(ConditionValue::Bool(!flag)),
                None => {
                    state.reasons.push(format!(
                        "operator ! requires a boolean, not a {}",
                        value.type_name()
                    ));
                    None
                }
            }
        }
        Expression::Binary(operator, left, right) => {
            let left = evaluate(left, state);
            let right = evaluate(right, state);
            evaluate_binary(*operator, left, right, state)
        }
    }
}

fn evaluate_binary(
    operator: BinaryOperator,
    left: Option<ConditionValue>,
    right: Option<ConditionValue>,
    state: &mut EvalState,
) -> Option<ConditionValue> {
    match operator {
        BinaryOperator::And | BinaryOperator::Or => {
            let left_bool = optional_bool(&left, operator, state)?;
            let right_bool = optional_bool(&right, operator, state)?;
            let result = if operator == BinaryOperator::And {
                and_result(left_bool, right_bool)
            } else {
                or_result(left_bool, right_bool)
            };
            result.map(ConditionValue::Bool)
        }
        BinaryOperator::Eq | BinaryOperator::Ne => {
            let left = left?;
            let right = right?;
            if std::mem::discriminant(&left) != std::mem::discriminant(&right) {
                state.reasons.push(format!(
                    "cannot compare {} with {} using {}",
                    left.type_name(),
                    right.type_name(),
                    operator_text(operator)
                ));
                return None;
            }
            let equal = left == right;
            Some(ConditionValue::Bool(if operator == BinaryOperator::Eq {
                equal
            } else {
                !equal
            }))
        }
        _ => {
            let left = left?;
            let right = right?;
            let left_number = match number_value(&left) {
                Some(number) => number,
                None => return reject_numbers(operator, state),
            };
            let right_number = match number_value(&right) {
                Some(number) => number,
                None => return reject_numbers(operator, state),
            };
            let result = match operator {
                BinaryOperator::Lt => left_number < right_number,
                BinaryOperator::Le => left_number <= right_number,
                BinaryOperator::Gt => left_number > right_number,
                _ => left_number >= right_number,
            };
            Some(ConditionValue::Bool(result))
        }
    }
}

fn optional_bool(
    value: &Option<ConditionValue>,
    operator: BinaryOperator,
    state: &mut EvalState,
) -> Option<Option<bool>> {
    match value {
        None => Some(None),
        Some(ConditionValue::Bool(flag)) => Some(Some(*flag)),
        Some(_) => {
            state.reasons.push(format!(
                "operator {} requires booleans",
                operator_text(operator)
            ));
            None
        }
    }
}

fn and_result(left: Option<bool>, right: Option<bool>) -> Option<bool> {
    if left == Some(false) || right == Some(false) {
        return Some(false);
    }
    if left.is_none() || right.is_none() {
        return None;
    }
    Some(true)
}

fn or_result(left: Option<bool>, right: Option<bool>) -> Option<bool> {
    if left == Some(true) || right == Some(true) {
        return Some(true);
    }
    if left.is_none() || right.is_none() {
        return None;
    }
    Some(false)
}

fn reject_numbers(operator: BinaryOperator, state: &mut EvalState) -> Option<ConditionValue> {
    state.reasons.push(format!(
        "operator {} requires numbers",
        operator_text(operator)
    ));
    None
}

fn operator_text(operator: BinaryOperator) -> &'static str {
    match operator {
        BinaryOperator::Or => "||",
        BinaryOperator::And => "&&",
        BinaryOperator::Eq => "==",
        BinaryOperator::Ne => "!=",
        BinaryOperator::Lt => "<",
        BinaryOperator::Le => "<=",
        BinaryOperator::Gt => ">",
        BinaryOperator::Ge => ">=",
    }
}

fn identifiers_of(tokens: &[Token]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for token in tokens {
        if let Token::Identifier(name) = token {
            if !out.contains(name) {
                out.push(name.clone());
            }
        }
    }
    out
}

fn values_of(
    symbols: &[String],
    values: &HashMap<String, ConditionValue>,
) -> HashMap<String, ConditionValue> {
    let mut out = HashMap::new();
    for name in symbols {
        if let Some(value) = resolve_value(values, name) {
            out.insert(name.clone(), value.clone());
        }
    }
    out
}

/// Evaluates one condition against the supplied constant values.
pub fn evaluate_syscond(text: &str, values: &HashMap<String, ConditionValue>) -> ConditionResult {
    let tokens = match tokenize(text) {
        Ok(tokens) => tokens,
        Err(error) => {
            return ConditionResult {
                state: ConditionState::Unknown,
                symbols: Vec::new(),
                missing: Vec::new(),
                values: HashMap::new(),
                error: Some(error),
            }
        }
    };
    let mut parser = Parser::new(&tokens);
    let expression = match parser.parse() {
        Some(expression) => expression,
        None => {
            let symbols = identifiers_of(&tokens);
            let values = values_of(&symbols, values);
            return ConditionResult {
                state: ConditionState::Unknown,
                symbols,
                missing: Vec::new(),
                values,
                error: Some(
                    parser
                        .failure
                        .clone()
                        .unwrap_or_else(|| "invalid expression".to_string()),
                ),
            };
        }
    };
    let mut state = EvalState {
        values,
        symbols: Vec::new(),
        missing: Vec::new(),
        reasons: Vec::new(),
    };
    let value = evaluate(&expression, &mut state);
    let condition_state = match &value {
        Some(ConditionValue::Bool(true)) => ConditionState::True,
        Some(ConditionValue::Bool(false)) => ConditionState::False,
        _ => {
            if let Some(value) = &value {
                if state.reasons.is_empty() {
                    state.reasons.push(format!(
                        "condition evaluates to a {}, not a boolean",
                        value.type_name()
                    ));
                }
            }
            ConditionState::Unknown
        }
    };
    let values = values_of(&state.symbols, values);
    let error = if condition_state == ConditionState::Unknown {
        state.reasons.first().cloned()
    } else {
        None
    };
    ConditionResult {
        state: condition_state,
        symbols: state.symbols,
        missing: state.missing,
        values,
        error,
    }
}
