/**
 * Range helpers for the pure-core tests. Test-only: no `vscode` import, no
 * expectations, so the tests stay runnable under plain Node as well.
 */

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
