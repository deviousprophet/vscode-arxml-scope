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
 * The source of `function name(...) { ... }` in `page`, by brace matching.
 *
 * A bundler may reformat the function, so callers that compare it against the host-side
 * twin should compare behaviour, not text; use `evaluateFunction` for that.
 */
export function functionSource(page: string, name: string): string {
	const marker = `function ${name}(`;
	const start = page.indexOf(marker);
	assert.notStrictEqual(start, -1, `the page inlines function ${name}`);
	const open = page.indexOf('{', start);
	let depth = 0;
	for (let at = open; at < page.length; at++) {
		const character = page[at];
		if (character === '{') {
			depth++;
		} else if (character === '}') {
			depth--;
			if (depth === 0) {
				return page.slice(start, at + 1);
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
