/**
 * Same-file reference resolution (parent design §7, child design §2.3).
 *
 * The caller passes the verbatim `/A/B/C` text (`targetRawPath`). The dotted
 * `targetPath` is display text only and is never used for lookup: converting it
 * back to slashes is ambiguous when a short-name contains a dot.
 *
 * Order: exact match, then the longest suffix of the target that matches exactly
 * one index key. An ambiguous suffix resolves to nothing — navigating to a wrong
 * element is worse than not navigating.
 */
import { Range } from './model';

/** Resolves a leading-slash raw path against the model's `pathIndex`. */
export function resolvePath(index: Map<string, Range>, rawPath: string): Range | undefined {
	const segments = rawPath.split('/').filter((s) => s.length > 0);
	if (segments.length === 0) {
		return undefined;
	}
	for (let start = 0; start < segments.length; start++) {
		const candidate = '/' + segments.slice(start).join('/');
		const exact = index.get(candidate);
		if (exact) {
			return exact;
		}
		const matches: Range[] = [];
		for (const [key, range] of index) {
			// `candidate` starts with '/', so `endsWith` can only match on a segment boundary.
			if (key.endsWith(candidate)) {
				matches.push(range);
			}
		}
		if (matches.length === 1) {
			return matches[0];
		}
		if (matches.length > 1) {
			return undefined; // ambiguous: refuse to guess
		}
	}
	return undefined;
}
