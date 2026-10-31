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
