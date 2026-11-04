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
	if (!trimmed.includes('*') && !trimmed.includes('?') && /\/$/.test(trimmed)) {
		return new RegExp(`^${escapeRegex(trimmed.slice(0, -1))}(?:/|$)`);
	}
	let source = '';
	for (let at = 0; at < trimmed.length; at++) {
		const character = trimmed[at];
		if (character === '*') {
			if (trimmed[at + 1] === '*') {
				at++;
				if (trimmed[at + 1] === '/') {
					at++;
					source += '(?:.*/)?';
				} else {
					source += '.*';
				}
			} else {
				source += '[^/]*';
			}
		} else if (character === '?') {
			source += '[^/]';
		} else {
			source += escapeRegex(character);
		}
	}
	return new RegExp(`^${source}$`);
}

function normalize(path: string): string {
	return path.replace(/\\/g, '/');
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
