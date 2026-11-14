//! Debug and parity helper for the Rust core.
//!
//! `info` prints the engine probe as JSON, `fixture-manifest` walks a directory and
//! prints a canonical byte/SHA-256 manifest (the TypeScript parity harness computes
//! the same manifest), and `scan` / `rows` print the engine's model and row JSON so
//! the parity suite can compare them against the TypeScript oracle.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use arxml_core::ecuc::{build_rows, scan_ecuc_values, Document, RowOptions};
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
        "merge-index" => merge_index_command(&args),
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

fn merge_index_command(args: &[String]) -> ExitCode {
    let text = match source(args) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(2);
        }
    };
    let document = Document::new(text);
    match serde_json::to_string(&document.merge_index()) {
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
