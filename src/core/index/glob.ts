/**
 * A deliberately small workspace-relative glob matcher for `arxmlScope.index.exclude`.
 *
 * Supported syntax is only what exclusion patterns need: `**` across segments,
 * `*` and `?` within a segment. Braces and extglobs are not implemented; the
 * setting documents workspace-relative globs and a library is the escape hatch
 * if that changes.
 */
export function compileExcludes(patterns: readonly string[]): (relativePath: string) => boolean {
	const compiled = patterns
		.map((pattern) => normalize(pattern).trim())
		.filter((pattern) => pattern !== '')
		.map(compilePattern);
	if (compiled.length === 0) {
		return () => false;
	}
	return (relativePath: string): boolean => {
		const path = normalize(relativePath).replace(/^\/+/, '');
		return compiled.some((matcher) => matcher.test(path));
	};
}

function compilePattern(pattern: string): RegExp {
	const trimmed = pattern.replace(/^\/+/, '');
	return isDirectoryPrefix(trimmed) ? compileDirectoryPrefix(trimmed) : compileWildcardPattern(trimmed);
}

/** A wildcard-free pattern with a trailing slash matches a directory and its contents. */
function isDirectoryPrefix(trimmed: string): boolean {
	return !hasWildcard(trimmed) && /\/$/.test(trimmed);
}

function hasWildcard(value: string): boolean {
	return value.includes('*') || value.includes('?');
}

function compileDirectoryPrefix(trimmed: string): RegExp {
	return new RegExp(`^${escapeRegex(trimmed.slice(0, -1))}(?:/|$)`);
}

function compileWildcardPattern(trimmed: string): RegExp {
	return new RegExp(`^${wildcardSource(trimmed)}$`);
}

/** One loop step of the wildcard translation: the regex source and the last index used. */
interface WildcardStep {
	source: string;
	next: number;
}

function wildcardSource(pattern: string): string {
	let source = '';
	for (let at = 0; at < pattern.length; at++) {
		const step = wildcardStep(pattern, at);
		source += step.source;
		at = step.next;
	}
	return source;
}

function wildcardStep(pattern: string, at: number): WildcardStep {
	const character = pattern[at];
	if (character === '*') {
		return starStep(pattern, at);
	}
	return { source: character === '?' ? '[^/]' : escapeRegex(character), next: at };
}

/** `**` spans segments, `*` stays within one. */
function starStep(pattern: string, at: number): WildcardStep {
	if (pattern[at + 1] !== '*') {
		return { source: '[^/]*', next: at };
	}
	if (pattern[at + 2] === '/') {
		return { source: '(?:.*/)?', next: at + 2 };
	}
	return { source: '.*', next: at + 1 };
}

function normalize(path: string): string {
	return path.replace(/\\/g, '/');
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
