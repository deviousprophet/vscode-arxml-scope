/**
 * ARXML Scope adapter. Reads only the built manifest and static assets; it does
 * not import `src/` at runtime. The product audit is the existing
 * `#preview-audit` JSON document emitted by the preview page.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { noConsoleErrors, noHorizontalOverflow } from '../../src/assertions/generic.mjs';
import { definePreview } from '../../src/adapters/contract.mjs';

const outDir = fileURLToPath(new URL('../../.out/arxml/', import.meta.url));
const manifestPath = path.join(outDir, 'manifest.json');
if (!existsSync(manifestPath)) {
	throw new Error(
		`missing ${manifestPath}; run "node adapters/arxml/build.mjs" (or npm run build:arxml) first`
	);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

/** Reads the product audit the preview page publishes on completion. */
async function readAudit(page) {
	return page.evaluate(() => {
		const node = document.querySelector('script#preview-audit');
		if (!node) {
			return null;
		}
		try {
			return JSON.parse(node.textContent ?? 'null');
		} catch {
			return null;
		}
	});
}

export default definePreview({
	name: 'arxml-scope',
	root: outDir,
	cspNonce: 'preview',
	settleMs: 50,
	states: manifest.states.map((state) => ({
		name: state.name,
		width: state.width,
		height: state.height,
		entry: state.entry,
		ready: 'body[data-preview-ready="true"]'
	})),
	assertions: [
		noHorizontalOverflow(),
		// The page's own error path already ignores this Monaco/ResizeObserver
		// noise; the console probe must mirror that judgement.
		noConsoleErrors({ ignore: [/ResizeObserver loop completed with undelivered notifications/] })
	],
	audit: readAudit,
	productAssertions: async ({ audit }) => {
		if (!audit) {
			return ['preview page published no #preview-audit document'];
		}
		if (audit.ready === false) {
			return ['preview page reported a render error'];
		}
		return Array.isArray(audit.violations) ? audit.violations : [];
	}
});
