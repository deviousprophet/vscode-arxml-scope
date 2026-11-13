/**
 * Builds the Rust engine binary and stages it for packaging.
 *
 * Writes `dist/engine/<platform>-<arch>/arxml-engine[.exe]`, the path the host
 * client loads. The binary is a release/CI artifact, not a source file.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const target = `${process.platform}-${process.arch}`;
const name = process.platform === 'win32' ? 'arxml-engine.exe' : 'arxml-engine';
const profile = process.argv.includes('--debug') ? 'debug' : 'release';

execFileSync(
	'cargo',
	['build', '--manifest-path', path.join(root, 'rust', 'Cargo.toml'), '-p', 'arxml-engine', ...(profile === 'release' ? ['--release'] : [])],
	{ stdio: 'inherit' }
);

const source = path.join(root, 'rust', 'target', profile, name);
const destinationDir = path.join(root, 'dist', 'engine', target);
mkdirSync(destinationDir, { recursive: true });
const destination = path.join(destinationDir, name);
copyFileSync(source, destination);
console.log(JSON.stringify({ _type: 'engine-build', target, profile, destination }));
