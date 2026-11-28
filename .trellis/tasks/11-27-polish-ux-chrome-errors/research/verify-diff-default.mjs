#!/usr/bin/env node
/**
 * Task-local facts for UX-05: the default diff view, the Context control and
 * the change count, read from the seeded diff-off preview state.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
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
				'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
				'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
				'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
			]
		: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge'];
const executablePath = process.env.CHROME_PATH ?? candidates.find((candidate) => existsSync(candidate));
if (executablePath === undefined) throw new Error('No Chrome or Edge found');

const preview = await startPreview({ port: 0 });
const browser = await chromium.launch({ executablePath, headless: true });
const findings = [];
try {
	for (const name of ['diff-off', 'diff-merge']) {
		const state = preview.states.find((candidate) => candidate.name === name);
		const page = await browser.newPage({ viewport: { width: state.width, height: state.height } });
		try {
			await page.goto(`http://127.0.0.1:${preview.port}/?state=${encodeURIComponent(name)}`, {
				waitUntil: 'load'
			});
			await page.waitForSelector('body[data-preview-ready="true"]', { timeout: 30_000 });
			await page.waitForTimeout(300);
			findings.push({
				state: name,
				...(await page.evaluate(() => {
					const context = document.getElementById('diff-context');
					const status = document.getElementById('diff-match-status');
					return {
						viewAllPressed: document.getElementById('diff-view-all')?.getAttribute('aria-pressed'),
						viewDiffPressed: document.getElementById('diff-view-diff')?.getAttribute('aria-pressed'),
						contextDisabled: context?.hasAttribute('disabled') ?? null,
						contextPressed: context?.getAttribute('aria-pressed') ?? null,
						statusText: status?.textContent ?? null
					};
				}))
			});
		} finally {
			await page.close();
		}
	}
	const report = { findings };
	mkdirSync(path.join(here, 'evidence'), { recursive: true });
	writeFileSync(path.join(here, 'evidence', 'diff-default.json'), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
} finally {
	await browser.close();
	preview.close();
}
