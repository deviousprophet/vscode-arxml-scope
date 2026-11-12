/**
 * Shared helpers for the pure-core tests. Test-only: no `vscode` import, no
 * expectations, so the tests stay runnable under plain Node as well.
 */
import * as fs from 'fs';
import * as path from 'path';

import { EcucDocumentModel } from '../../core/ecuc/model';
import { scanEcucValues } from '../../core/ecuc/scanner';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

/** Reads a synthetic fixture's text. */
export function fixtureText(name: string): string {
	return fs.readFileSync(path.join(repoRoot, 'src', 'test', 'fixtures', name), 'utf8');
}

/** Reads a committed expected model, ignoring fields retired from the model. */
export function expectedModel(name: string): unknown {
	const raw = fs.readFileSync(path.join(repoRoot, 'src', 'test', 'expected', name), 'utf8');
	return JSON.parse(raw, (key, value) =>
		key === 'definitionDest' || key === 'targetDest' || key === 'hexValue' ? undefined : value
	);
}

/** Scans a fixture. */
export function scanFixture(name: string): EcucDocumentModel {
	return scanEcucValues(fixtureText(name));
}

/**
 * JSON-clean view of a model: `pathIndex` becomes a `[key, range]` array.
 * `definitionDest` is asserted for every fixture parameter by the focused
 * scanner test; the committed expected models predate it. `hexValue` was removed
 * from the model after the Document display stopped using it. Both legacy fields
 * are omitted from this oracle.
 */
export function plain(model: EcucDocumentModel): unknown {
	return JSON.parse(
		JSON.stringify(
			{
				schema: model.schema,
				packages: model.packages,
				modules: model.modules,
				pathIndex: [...model.pathIndex],
			},
			(key, value) => (key === 'definitionDest' || key === 'targetDest' || key === 'hexValue' ? undefined : value)
		)
	);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object';
}

function hasRangeKeys(keys: readonly string[]): boolean {
	return keys.length === 2 && keys.includes('start') && keys.includes('end');
}

function isRange(value: unknown): boolean {
	return isObject(value) && hasRangeKeys(Object.keys(value)) && isNumberPair(value);
}

function isNumberPair(value: Record<string, unknown>): boolean {
	return typeof value.start === 'number' && typeof value.end === 'number';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return isObject(value) && !Array.isArray(value);
}

function stripObject(value: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, inner] of Object.entries(value)) {
		if (!isRange(inner)) {
			out[key] = stripRanges(inner);
		}
	}
	return out;
}

/** Recursively removes every range, for layout-independence comparisons. */
export function stripRanges(value: unknown): unknown {
	if (Array.isArray(value)) {
		// A `[key, range]` pathIndex pair loses its range, so only keys are compared.
		return value.filter((entry) => !isRange(entry)).map(stripRanges);
	}
	if (isRecord(value)) {
		return stripObject(value);
	}
	return value;
}

/** The text a range points at. */
export function slice(text: string, range: { start: number; end: number }): string {
	return text.slice(range.start, range.end);
}
