//! Debug and parity helper for the Rust core.
//!
//! `info` prints the engine probe as JSON. `fixture-manifest` walks a directory
//! and prints a canonical byte/SHA-256 manifest; the TypeScript parity harness
//! computes the same manifest and compares it.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

#[derive(Debug, Serialize)]
struct Info {
    hello: String,
    version: String,
    abi: u32,
}

#[derive(Debug, Serialize)]
struct FixtureEntry {
    path: String,
    bytes: u64,
    sha256: String,
}

#[derive(Debug, Serialize)]
struct FixtureManifest {
    fixtures: Vec<FixtureEntry>,
}

fn collect_fixtures(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|error| format!("{}: {error}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_fixtures(&path, out)?;
        } else if path.extension().and_then(|extension| extension.to_str()) == Some("arxml") {
            out.push(path);
        }
    }
    Ok(())
}

fn manifest(root: &Path) -> Result<FixtureManifest, String> {
    let mut paths = Vec::new();
    collect_fixtures(root, &mut paths)?;
    paths.sort();

    let mut fixtures = Vec::with_capacity(paths.len());
    for path in paths {
        let bytes = fs::read(&path).map_err(|error| format!("{}: {error}", path.display()))?;
        let relative = path
            .strip_prefix(root)
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        fixtures.push(FixtureEntry {
            path: relative,
            bytes: bytes.len() as u64,
            sha256: format!("{:x}", Sha256::digest(&bytes)),
        });
    }
    Ok(FixtureManifest { fixtures })
}

fn print_info() -> Result<(), String> {
    let info = Info {
        hello: arxml_core::engine_hello(),
        version: arxml_core::engine_version().to_string(),
        abi: arxml_core::ENGINE_ABI,
    };
    let text = serde_json::to_string_pretty(&info).map_err(|error| error.to_string())?;
    println!("{text}");
    Ok(())
}

fn arg_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].as_str())
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("info") => print_info(),
        Some("fixture-manifest") => {
            let dir = arg_value(&args, "--dir").ok_or("fixture-manifest requires --dir <path>")?;
            let manifest = manifest(Path::new(dir))?;
            let text =
                serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?;
            println!("{text}");
            Ok(())
        }
        Some(other) => Err(format!("unknown command: {other}")),
        None => Err("usage: arxml-cli <info|fixture-manifest --dir <path>>".to_string()),
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
