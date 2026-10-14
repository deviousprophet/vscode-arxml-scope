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

/** Reads a committed expected model. */
export function expectedModel(name: string): unknown {
	const raw = fs.readFileSync(path.join(repoRoot, 'src', 'test', 'expected', name), 'utf8');
	return JSON.parse(raw);
}

/** Scans a fixture. */
export function scanFixture(name: string): EcucDocumentModel {
	return scanEcucValues(fixtureText(name));
}

/** JSON-clean view of a model: `pathIndex` becomes a `[key, range]` array. */
export function plain(model: EcucDocumentModel): unknown {
	return JSON.parse(
		JSON.stringify({
			schema: model.schema,
			packages: model.packages,
			modules: model.modules,
			pathIndex: [...model.pathIndex],
		})
	);
}

function isRange(value: unknown): boolean {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const keys = Object.keys(value as object);
	return (
		keys.length === 2 &&
		keys.includes('start') &&
		keys.includes('end') &&
		typeof (value as { start: unknown }).start === 'number' &&
		typeof (value as { end: unknown }).end === 'number'
	);
}

/** Recursively removes every range, for layout-independence comparisons (AC4). */
export function stripRanges(value: unknown): unknown {
	if (Array.isArray(value)) {
		// A `[key, range]` pathIndex pair loses its range, so only keys are compared.
		return value.filter((entry) => !isRange(entry)).map(stripRanges);
	}
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, inner] of Object.entries(value)) {
			if (!isRange(inner)) {
				out[key] = stripRanges(inner);
			}
		}
		return out;
	}
	return value;
}

/** The text a range points at. */
export function slice(text: string, range: { start: number; end: number }): string {
	return text.slice(range.start, range.end);
}
