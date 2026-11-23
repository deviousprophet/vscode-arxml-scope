/**
 * Read a colocated stylesheet from the source tree.
 *
 * The test host cannot import CSS, and the assertions are about the source the
 * bundler consumes; esbuild's emitted bundle is checked separately by the page
 * shell tests.
 */
import * as fs from 'fs';
import * as path from 'path';

const WEBVIEW_ROOT = path.resolve(__dirname, '..', '..', '..', 'src', 'webview');

/** The text of one stylesheet below `src/webview`. */
export function webviewCss(...segments: string[]): string {
	return fs.readFileSync(path.join(WEBVIEW_ROOT, ...segments), 'utf8');
}

/** The text of one TypeScript module below `src/webview`, for shared-load tests. */
export function webviewSource(...segments: string[]): string {
	return fs.readFileSync(path.join(WEBVIEW_ROOT, ...segments), 'utf8');
}

/** The fixed colour literals the Document/diff stylesheets may contain. */
const ALLOWED_VIEW_HEX = [
	'#4EC9B0',
	'#80808040',
	'#DCDCAA',
	'#569cd6',
	'#c586c0',
	'#4fc1ff',
	'#0000ff',
	'#af00db',
	'#0070c1'
];

/** A sorted copy of the allowed literals for exact-list assertions. */
export function allowedViewHex(): string[] {
	return ALLOWED_VIEW_HEX.slice().sort();
}
