#!/usr/bin/env node
/**
 * Task-local measurement for UX-04: the host diff webview is 1082 px wide at
 * 1440 px / 100 % zoom. The seeded preview states stop at 1200/1024, so this
 * loads the 1400 state at the host width and records which labels survive.
 *
 *   node .trellis/tasks/11-27-polish-ux-chrome-errors/research/measure-toolbar-1082.mjs
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

function findBrowser() {
	if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
	const candidates =
		process.platform === 'win32'
			? [
					'C:/Program Files/Google/Chrome/Application/chrome.exe',
					'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
					'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
					'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
				]
			: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge'];
	return candidates.find((candidate) => existsSync(candidate));
}

const WIDTH = Number(process.env.PROBE_WIDTH ?? 1082);
const executablePath = findBrowser();
if (executablePath === undefined) {
	throw new Error('No Chrome or Edge found. Set CHROME_PATH.');
}

const preview = await startPreview({ port: 0 });
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });
try {
	await page.goto(`http://127.0.0.1:${preview.port}/?state=${encodeURIComponent('toolbar-1400')}`, {
		waitUntil: 'load'
	});
	await page.waitForSelector('body[data-preview-ready="true"]', { timeout: 30_000 });
	await page.waitForTimeout(300);
	const measured = await page.evaluate(() => {
		const labelOf = (id) => {
			const button = document.getElementById(id);
			const label = button?.querySelector('.lbl');
			return {
				id,
				label: label?.textContent ?? null,
				// The toolbar may be icon-only at this width; the label is the contract.
				visible: label !== null && getComputedStyle(label).display !== 'none'
			};
		};
		const rect = (selector) => {
			const element = document.querySelector(selector);
			if (element === null) return null;
			const box = element.getBoundingClientRect();
			return { left: box.left, right: box.right, width: box.width };
		};
		const ids = [...document.querySelectorAll('.diff-tool')].map((element) => element.id);
		return {
			viewport: window.innerWidth,
			buttons: ids.map(labelOf),
			left: rect('.toolbar-left'),
			right: rect('.toolbar-right'),
			toolbar: rect('.toolbar'),
			labelsDropped: ids.filter((id) => !labelOf(id).visible)
		};
	});
	const report = { state: 'toolbar-1400', width: WIDTH, ...measured };
	mkdirSync(path.join(here, 'evidence'), { recursive: true });
	writeFileSync(path.join(here, 'evidence', `toolbar-${WIDTH}.json`), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
	if (report.left !== null && report.right !== null && report.left.right > report.right.left) {
		throw new Error('toolbar groups overlap at this width');
	}
} finally {
	await page.close();
	await browser.close();
	await preview.close?.();
}
