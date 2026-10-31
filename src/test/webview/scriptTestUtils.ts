/**
 * Test-only helpers for inspecting the inlined webview script.
 *
 * `@vscode/test-electron` exposes no webview DOM, so the page is a string here. These
 * helpers locate a named function in that string by brace matching, so an assertion can
 * be scoped to it, and compile it, so the page's own copy of a helper can be driven
 * rather than merely grepped — which is what makes "the page and the tests share one
 * definition" an assertion instead of a claim. Nothing here is imported by
 * `src/editor/**`.
 */
import * as assert from 'assert';

/**
 * The index after a string or comment starting at `at`, or `at` when there is none.
 * Page helpers are plain script, but comments (with apostrophes) and literals keep
 * brace matching honest for a function that mentions `{` or `}` in text.
 */
function skipNonCode(source: string, at: number): number {
	const character = source[at];
	if (character === '/' && source[at + 1] === '/') {
		const end = source.indexOf('\n', at + 2);
		return end === -1 ? source.length : end;
	}
	if (character === '/' && source[at + 1] === '*') {
		const end = source.indexOf('*/', at + 2);
		return end === -1 ? source.length : end + 2;
	}
	if (character !== '"' && character !== "'" && character !== '`') {
		return at;
	}
	const quote = character;
	for (let cursor = at + 1; cursor < source.length; cursor++) {
		if (source[cursor] === '\\') {
			cursor++;
		} else if (source[cursor] === quote) {
			return cursor + 1;
		}
	}
	return source.length;
}

/**
 * The source of `function name(...) { ... }` in `page`.
 *
 * The parameter list is matched first so a default object parameter (`options = {}`)
 * cannot be mistaken for the function body. A bundler may reformat the function, so
 * callers that compare it against the host-side twin should compare behaviour, not
 * text; use `evaluateFunction` for that.
 */
export function functionSource(page: string, name: string): string {
	const marker = `function ${name}(`;
	const start = page.indexOf(marker);
	assert.notStrictEqual(start, -1, `the page inlines function ${name}`);
	const parameters = page.indexOf('(', start);
	let depth = 0;
	let at = parameters;
	for (; at < page.length; at++) {
		const skipped = skipNonCode(page, at);
		if (skipped !== at) {
			at = skipped - 1;
			continue;
		}
		const character = page[at];
		if (character === '(') {
			depth++;
		} else if (character === ')') {
			depth--;
			if (depth === 0) {
				at++;
				break;
			}
		}
	}
	const open = page.indexOf('{', at);
	assert.notStrictEqual(open, -1, `function ${name} has a body`);
	depth = 0;
	for (let cursor = open; cursor < page.length; cursor++) {
		const skipped = skipNonCode(page, cursor);
		if (skipped !== cursor) {
			cursor = skipped - 1;
			continue;
		}
		const character = page[cursor];
		if (character === '{') {
			depth++;
		} else if (character === '}') {
			depth--;
			if (depth === 0) {
				return page.slice(start, cursor + 1);
			}
		}
	}
	assert.fail(`function ${name} is not closed`);
}

/**
 * The page's own copy of a named function, compiled, so a test drives exactly what the
 * webview will run rather than the host-side twin it was serialized from. The extracted
 * function must not reference anything the page declares outside it.
 */
export function evaluateFunction<F>(page: string, name: string): F {
	return new Function(`${functionSource(page, name)}\nreturn ${name};`)() as F;
}
