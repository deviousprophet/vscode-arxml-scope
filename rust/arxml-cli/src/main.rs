//! Debug and parity helper for the Rust core.
//!
//! `info` prints the engine probe as JSON, `fixture-manifest` walks a directory and
//! prints a canonical byte/SHA-256 manifest (the TypeScript parity harness computes
//! the same manifest), and `scan` / `rows` print the engine's model and row JSON so
//! the parity suite can compare them against the TypeScript oracle.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use arxml_core::diff::{build_diff_document, DiffHeader, DiffOptions, DiffSide, FileLabel};
use arxml_core::ecuc::{build_rows, scan_ecuc_values, Document, RowOptions};
use arxml_core::word::{diff_words, WordPair};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};

/// One fixture entry. Field order is part of the parity contract with `scripts/parity.mjs`.
#[derive(Serialize)]
struct FixtureEntry {
    path: String,
    bytes: u64,
    sha256: String,
}

/// The canonical fixture manifest, byte-identical to the TypeScript side.
#[derive(Serialize)]
struct FixtureManifest {
    fixtures: Vec<FixtureEntry>,
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(command) = args.first().map(String::as_str) else {
        eprintln!("usage: arxml-cli <info|fixture-manifest|scan|rows> [options]");
        return ExitCode::from(2);
    };
    match command {
        "info" => {
            println!(
                "{}",
                json!({
                    "engine": arxml_core::engine_hello(),
                    "protocol": arxml_core::ENGINE_PROTOCOL,
                })
            );
            ExitCode::SUCCESS
        }
        "fixture-manifest" => fixture_manifest(&args),
        "scan" => scan_command(&args),
        "rows" => rows_command(&args),
        "diff" => diff_command(&args),
        "words" => words_command(&args),
        other => {
            eprintln!("unknown command {other}");
            ExitCode::from(2)
        }
    }
}

fn option<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|index| args.get(index + 1))
        .map(String::as_str)
}

fn source(args: &[String]) -> Result<String, String> {
    let path = option(args, "--file").ok_or("--file is required")?;
    fs::read_to_string(path).map_err(|error| format!("{path}: {error}"))
}

fn scan_command(args: &[String]) -> ExitCode {
    let text = match source(args) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(2);
        }
    };
    let model = scan_ecuc_values(text);
    match serde_json::to_string(&model) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
    }
}

fn rows_command(args: &[String]) -> ExitCode {
    let text = match source(args) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(2);
        }
    };
    let mut options = RowOptions::default();
    if let Some(sort) = option(args, "--sort") {
        options.sort = Some(sort.to_string());
    }
    if let Some(sort_except) = option(args, "--sort-except") {
        options.sort_except = Some(sort_except.split(',').map(str::to_string).collect());
    }
    let model = scan_ecuc_values(text);
    let rows = build_rows(&model, &options);
    match serde_json::to_string(&rows) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
    }
}

fn file_label(path: &str) -> FileLabel {
    let name = std::path::Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());
    FileLabel {
        name,
        path: path.replace('\\', "/"),
    }
}

fn header_of(document: &Document) -> DiffHeader {
    let model = document.model();
    DiffHeader {
        schema: model.schema.as_ref().map(|schema| schema.release.clone()),
        packages: model
            .packages
            .iter()
            .map(|package| package.path.join("."))
            .collect(),
    }
}

fn diff_command(args: &[String]) -> ExitCode {
    let (Some(left_path), Some(right_path)) = (option(args, "--left"), option(args, "--right"))
    else {
        eprintln!("--left and --right are required");
        return ExitCode::from(2);
    };
    let read = |path: &str| fs::read_to_string(path).map_err(|error| format!("{path}: {error}"));
    let left = match read(left_path) {
        Ok(text) => Document::new(text),
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(2);
        }
    };
    let right = match read(right_path) {
        Ok(text) => Document::new(text),
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(2);
        }
    };
    let left_lookup = |id: &str| left.index().get(id).map(|entry| entry.range);
    let right_lookup = |id: &str| right.index().get(id).map(|entry| entry.range);
    let semantic = args.iter().any(|arg| arg == "--semantic");
    let budget = match option(args, "--budget") {
        Some(value) => match value.parse::<u32>() {
            Ok(budget) => Some(budget),
            Err(_) => {
                eprintln!("--budget needs a non-negative integer");
                return ExitCode::from(2);
            }
        },
        None => None,
    };
    let document = build_diff_document(
        DiffSide {
            label: file_label(left_path),
            header: header_of(&left),
            rows: left.rows(),
            range: &left_lookup,
        },
        DiffSide {
            label: file_label(right_path),
            header: header_of(&right),
            rows: right.rows(),
            range: &right_lookup,
        },
        &DiffOptions {
            semantic_matching: semantic,
            semantic_pair_budget: budget,
        },
    );
    match serde_json::to_string(&document) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
    }
}

fn words_command(args: &[String]) -> ExitCode {
    let Some(path) = option(args, "--pairs") else {
        eprintln!("--pairs is required");
        return ExitCode::from(2);
    };
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("{path}: {error}");
            return ExitCode::from(2);
        }
    };
    let pairs: Vec<(String, String)> = match serde_json::from_str(&text) {
        Ok(pairs) => pairs,
        Err(error) => {
            eprintln!("{path}: {error}");
            return ExitCode::from(2);
        }
    };
    let pairs: Vec<WordPair> = pairs
        .into_iter()
        .map(|(left, right)| diff_words(&left, &right))
        .collect();
    match serde_json::to_string(&pairs) {
        Ok(json) => {
            println!("{json}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
    }
}

fn fixture_manifest(args: &[String]) -> ExitCode {
    let dir = option(args, "--dir").unwrap_or("src/test/fixtures");
    let root = PathBuf::from(dir);
    let mut files = Vec::new();
    if walk(&root, &mut files).is_err() {
        return ExitCode::from(2);
    }
    files.sort();
    let fixtures: Vec<FixtureEntry> = files
        .iter()
        .filter_map(|path| {
            let bytes = fs::read(path).ok()?;
            Some(FixtureEntry {
                path: relative(&root, path),
                bytes: bytes.len() as u64,
                sha256: format!("{:x}", Sha256::digest(&bytes)),
            })
        })
        .collect();
    match serde_json::to_string_pretty(&FixtureManifest { fixtures }) {
        Ok(text) => {
            println!("{text}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
    }
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out)?;
        } else if path.extension().map(|ext| ext == "arxml").unwrap_or(false) {
            out.push(path);
        }
    }
    Ok(())
}
