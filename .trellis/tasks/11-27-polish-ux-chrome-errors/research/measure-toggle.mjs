#!/usr/bin/env node
/** UX-03 evidence: the sidebar toggle's pressed paint in the seeded editor state. */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreview } from '../../../../.agents/skills/ux-review/scripts/preview/previewWebview.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const requireFromPreview = createRequire(path.join(repoRoot, 'packages/webview-preview/package.json'));
const { chromium } = requireFromPreview('@playwright/test');

const candidates =
	process.platform === 'win32'
		? [
				'C:/Program Files/Google/Chrome/Application/chrome.exe',
				'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
			]
		: ['/usr/bin/google-chrome', '/usr/bin/chromium'];
const executablePath = process.env.CHROME_PATH ?? candidates.find((candidate) => existsSync(candidate));
if (executablePath === undefined) throw new Error('No Chrome or Edge found');

const preview = await startPreview({ port: 0 });
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
try {
	await page.goto(`http://127.0.0.1:${preview.port}/?state=editor`, { waitUntil: 'load' });
	await page.waitForSelector('body[data-preview-ready="true"]', { timeout: 30_000 });
	await page.waitForTimeout(300);
	const result = await page.evaluate(() => {
		const toggle = document.getElementById('toggle-sidebar');
		const style = getComputedStyle(toggle);
		return {
			ariaPressed: toggle?.getAttribute('aria-pressed'),
			background: style.backgroundColor,
			color: style.color,
			width: style.width,
			height: style.height
		};
	});
	console.log(JSON.stringify(result, null, 2));
} finally {
	await browser.close();
	preview.close();
}
