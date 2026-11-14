//! Word-level comparison for one displayed diff field.
//!
//! The diff compares whole fields; this helper turns a changed field into unchanged
//! and changed runs so a changed row can show exactly which words moved. A port of
//! `src/core/diff/wordDiff.ts`, asserted through the same segment pairs.
//!
//! Tokenization is deliberately small: whitespace runs stay one token, an identifier
//! is `[A-Za-z0-9_]+` (so `0x1F` is one token) and every other character is its own
//! token (so `/Pkg/Diff` is `/`, `Pkg`, `/`, `Diff`). Unmatched tokens are changed;
//! adjacent segments with the same flag merge.
//!
//! Tokens are `char`s, not UTF-16 units. The page reads `text[at]` as one code unit,
//! which splits a surrogate pair into two tokens; doing the same here would put lone
//! surrogates into a JSON string, which Rust cannot encode. A character keeps the
//! output valid and only changes the pairing for two lone surrogates in one field.

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct WordSegment {
    pub text: String,
    pub changed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct WordPair {
    pub left: Vec<WordSegment>,
    pub right: Vec<WordSegment>,
}

fn is_identifier(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_'
}

fn is_whitespace(character: char) -> bool {
    matches!(character, ' ' | '\t' | '\r' | '\n')
}

fn run_end(characters: &[char], at: usize, accept: fn(char) -> bool) -> usize {
    let mut end = at;
    while end < characters.len() && accept(characters[end]) {
        end += 1;
    }
    end
}

/// The end of the token that starts at `at`: a whitespace run, an identifier or one
/// character.
fn token_end(characters: &[char], at: usize) -> usize {
    let character = characters[at];
    if is_whitespace(character) {
        return run_end(characters, at, is_whitespace);
    }
    if is_identifier(character) {
        return run_end(characters, at, is_identifier);
    }
    at + 1
}

/// Splits one field into whitespace, identifier and single-punctuation tokens.
fn tokenize(text: &str) -> Vec<String> {
    let characters: Vec<char> = text.chars().collect();
    let mut tokens = Vec::new();
    let mut at = 0;
    while at < characters.len() {
        let end = token_end(&characters, at);
        tokens.push(characters[at..end].iter().collect());
        at = end;
    }
    tokens
}

struct TokenMatch {
    left: Vec<bool>,
    right: Vec<bool>,
}

/// Suffix lengths let the forward walk match the earliest equal token, which keeps a
/// repeated separator (whitespace) on the segment a reader expects.
fn suffix_table(left: &[String], right: &[String]) -> Vec<Vec<u32>> {
    let rows = left.len();
    let columns = right.len();
    let mut table = vec![vec![0u32; columns + 1]; rows + 1];
    for row in (0..rows).rev() {
        for column in (0..columns).rev() {
            table[row][column] = if left[row] == right[column] {
                table[row + 1][column + 1] + 1
            } else {
                table[row + 1][column].max(table[row][column + 1])
            };
        }
    }
    table
}

/// Marks the tokens that belong to one longest common subsequence.
fn longest_common(left: &[String], right: &[String]) -> TokenMatch {
    let table = suffix_table(left, right);
    let mut matched_left = vec![false; left.len()];
    let mut matched_right = vec![false; right.len()];
    let mut row = 0;
    let mut column = 0;
    while row < left.len() && column < right.len() {
        if left[row] == right[column] {
            matched_left[row] = true;
            matched_right[column] = true;
            row += 1;
            column += 1;
        } else if table[row + 1][column] >= table[row][column + 1] {
            row += 1;
        } else {
            column += 1;
        }
    }
    TokenMatch {
        left: matched_left,
        right: matched_right,
    }
}

/// Groups consecutive tokens with the same flag into visible segments.
fn segments_of(tokens: &[String], matched: &[bool]) -> Vec<WordSegment> {
    let mut segments: Vec<WordSegment> = Vec::new();
    for (at, token) in tokens.iter().enumerate() {
        let changed = !matched[at];
        match segments.last_mut() {
            Some(last) if last.changed == changed => last.text.push_str(token),
            _ => segments.push(WordSegment {
                text: token.clone(),
                changed,
            }),
        }
    }
    segments
}

fn unchanged_pair(text: &str) -> WordPair {
    let unchanged = if text.is_empty() {
        Vec::new()
    } else {
        vec![WordSegment {
            text: text.to_string(),
            changed: false,
        }]
    };
    WordPair {
        left: unchanged.clone(),
        right: unchanged,
    }
}

/// Compares two displayed strings by token. An identical pair is one unchanged
/// segment per side; an empty side leaves the other side entirely changed.
pub fn diff_words(left: &str, right: &str) -> WordPair {
    if left == right {
        return unchanged_pair(left);
    }
    if left.is_empty() {
        return WordPair {
            left: Vec::new(),
            right: vec![WordSegment {
                text: right.to_string(),
                changed: true,
            }],
        };
    }
    if right.is_empty() {
        return WordPair {
            left: vec![WordSegment {
                text: left.to_string(),
                changed: true,
            }],
            right: Vec::new(),
        };
    }
    let left_tokens = tokenize(left);
    let right_tokens = tokenize(right);
    let matched = longest_common(&left_tokens, &right_tokens);
    WordPair {
        left: segments_of(&left_tokens, &matched.left),
        right: segments_of(&right_tokens, &matched.right),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(segments: &[WordSegment]) -> String {
        segments
            .iter()
            .map(|segment| segment.text.as_str())
            .collect()
    }

    fn segment(text: &str, changed: bool) -> WordSegment {
        WordSegment {
            text: text.to_string(),
            changed,
        }
    }

    #[test]
    fn an_identical_pair_is_one_unchanged_segment_per_side() {
        let pair = diff_words("Timeout", "Timeout");
        assert_eq!(pair.left, vec![segment("Timeout", false)]);
        assert_eq!(pair.right, vec![segment("Timeout", false)]);
        assert_eq!(
            diff_words("", ""),
            WordPair {
                left: Vec::new(),
                right: Vec::new()
            }
        );
    }

    #[test]
    fn changed_tokens_are_marked_and_their_surroundings_are_not() {
        let pair = diff_words("Timeout 100", "Timeout 200");
        assert_eq!(
            pair.left,
            vec![segment("Timeout ", false), segment("100", true)]
        );
        assert_eq!(
            pair.right,
            vec![segment("Timeout ", false), segment("200", true)]
        );
    }

    #[test]
    fn an_empty_side_marks_the_whole_other_side_changed() {
        assert_eq!(
            diff_words("", "Added"),
            WordPair {
                left: Vec::new(),
                right: vec![segment("Added", true)]
            }
        );
        assert_eq!(
            diff_words("Gone", ""),
            WordPair {
                left: vec![segment("Gone", true)],
                right: Vec::new()
            }
        );
    }

    #[test]
    fn each_punctuation_character_is_its_own_token() {
        let pair = diff_words("(a)", "(b)");
        assert_eq!(
            pair.left,
            vec![segment("(", false), segment("a", true), segment(")", false)]
        );
        assert_eq!(
            pair.right,
            vec![segment("(", false), segment("b", true), segment(")", false)]
        );
    }

    #[test]
    fn a_path_keeps_the_shared_prefix() {
        let pair = diff_words("/Pkg/Diff", "/Pkg/Other");
        assert_eq!(
            pair.left,
            vec![segment("/Pkg/", false), segment("Diff", true)]
        );
        assert_eq!(
            pair.right,
            vec![segment("/Pkg/", false), segment("Other", true)]
        );
        let inside = diff_words("/Pkg/Diff", "/PkgX/Diff");
        assert_eq!(
            inside.left,
            vec![
                segment("/", false),
                segment("Pkg", true),
                segment("/Diff", false)
            ]
        );
    }

    #[test]
    fn segments_reassemble_the_input() {
        for (left, right) in [
            ("Timeout 100", "Timeout 200"),
            ("a  b", "a b"),
            ("0x1F", "0x2F"),
            ("/Pkg/Diff", "/PkgX/Diff"),
            ("é value", "e value"),
            ("a😀b", "a😀c"),
        ] {
            let pair = diff_words(left, right);
            assert_eq!(text(&pair.left), left);
            assert_eq!(text(&pair.right), right);
        }
    }

    #[test]
    fn whitespace_runs_stay_one_token() {
        let pair = diff_words("a  b", "a b");
        assert_eq!(text(&pair.left), "a  b");
        assert_eq!(text(&pair.right), "a b");
        assert!(pair.left.iter().any(|segment| segment.text == "  "));
        assert_eq!(
            pair.left.iter().filter(|segment| segment.changed).count(),
            1
        );
    }
}
