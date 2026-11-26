/** Toy adapter: proves the core with a webview that has no ARXML knowledge. */
import { fileURLToPath } from 'node:url';
import { allVisible, noClippedControls, noConsoleErrors, noHorizontalOverflow, noOverlap } from '../../src/assertions/generic.mjs';
import { definePreview } from '../../src/adapters/contract.mjs';

const root = fileURLToPath(new URL('../../fixtures/toy/', import.meta.url));
const controls = '.toy-button:not([hidden])';

/** Delivers one state envelope and waits until the page applied it. */
async function use(page, post, state) {
	await post({ type: 'toy-state', state });
	await page.waitForFunction((name) => window.__toyState === name, state.name);
	await page.waitForSelector('body[data-preview-ready="true"]', { state: 'attached' });
}

export default definePreview({
	name: 'toy',
	root,
	entry: 'index.html',
	settleMs: 50,
	states: [
		{
			name: 'toy-ok',
			width: 800,
			height: 600,
			ready: 'body[data-preview-ready="true"]',
			setup: (page, { post }) =>
				use(page, post, { name: 'toy-ok', classes: [], text: 'All controls are laid out.' })
		},
		{
			name: 'toy-overflow',
			width: 800,
			height: 600,
			ready: 'body[data-preview-ready="true"]',
			setup: (page, { post }) =>
				use(page, post, { name: 'toy-overflow', classes: ['overflow'], text: 'Content is 2000px wide.' })
		},
		{
			name: 'toy-clipped',
			width: 800,
			height: 600,
			ready: 'body[data-preview-ready="true"]',
			setup: (page, { post }) =>
				use(page, post, { name: 'toy-clipped', classes: ['clipped'], text: 'A button is too narrow.' })
		},
		{
			name: 'toy-overlap',
			width: 800,
			height: 600,
			ready: 'body[data-preview-ready="true"]',
			setup: (page, { post }) =>
				use(page, post, { name: 'toy-overlap', classes: ['overlap'], text: 'Two buttons overlap.' })
		},
		{
			name: 'toy-hidden',
			width: 800,
			height: 600,
			ready: 'body[data-preview-ready="true"]',
			setup: (page, { post }) =>
				use(page, post, { name: 'toy-hidden', classes: ['hide'], text: 'A toolbar control disappeared.' })
		},
		{
			name: 'toy-console',
			width: 800,
			height: 600,
			ready: 'body[data-preview-ready="true"]',
			trace: true,
			setup: (page, { post }) =>
				use(page, post, {
					name: 'toy-console',
					classes: [],
					text: 'A state logs an error.',
					consoleError: 'toy state failure'
				})
		}
	],
	assertions: [
		noHorizontalOverflow(),
		noClippedControls({ selector: controls }),
		noOverlap({ selector: controls }),
		allVisible({ selector: controls, min: 3 }),
		noConsoleErrors()
	]
});
