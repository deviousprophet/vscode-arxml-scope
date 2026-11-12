/**
 * Same-file reference resolution.
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

interface CandidateMatch {
	status: 'found' | 'missing' | 'ambiguous';
	range: Range | undefined;
}

/** Non-empty `/`-separated segments of the raw path. */
function pathSegments(rawPath: string): string[] {
	return rawPath.split('/').filter((s) => s.length > 0);
}

/** The `/`-joined suffix of `segments` starting at `start`. */
function pathCandidate(segments: readonly string[], start: number): string {
	return '/' + segments.slice(start).join('/');
}

/** Every index range whose key ends with the candidate path. */
function suffixMatches(index: Map<string, Range>, candidate: string): Range[] {
	const matches: Range[] = [];
	for (const [key, range] of index) {
		// `candidate` starts with '/', so `endsWith` can only match on a segment boundary.
		if (key.endsWith(candidate)) {
			matches.push(range);
		}
	}
	return matches;
}

/** Exact key, then a unique suffix; an ambiguous suffix refuses to guess. */
function matchCandidate(index: Map<string, Range>, candidate: string): CandidateMatch {
	const exact = index.get(candidate);
	if (exact) {
		return { status: 'found', range: exact };
	}
	const matches = suffixMatches(index, candidate);
	if (matches.length > 1) {
		return { status: 'ambiguous', range: undefined };
	}
	return matches.length === 1
		? { status: 'found', range: matches[0] }
		: { status: 'missing', range: undefined };
}

/** Resolves a leading-slash raw path against the model's `pathIndex`. */
export function resolvePath(index: Map<string, Range>, rawPath: string): Range | undefined {
	const segments = pathSegments(rawPath);
	if (segments.length === 0) {
		return undefined;
	}
	for (let start = 0; start < segments.length; start++) {
		const match = matchCandidate(index, pathCandidate(segments, start));
		if (match.status === 'missing') {
			continue;
		}
		return match.range;
	}
	return undefined;
}
