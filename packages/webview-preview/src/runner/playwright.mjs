/**
 * Low-level Playwright launch and per-state capture. The official
 * `@playwright/test` package supplies Chromium; a system Chrome/Edge is used so
 * the spike never downloads a browser bundle.
 */
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

const WINDOWS_CANDIDATES = [
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
	'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];

const MAC_CANDIDATES = [
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
];

const LINUX_CANDIDATES = [
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
	'/usr/bin/chromium-browser',
	'/usr/bin/microsoft-edge'
];

function findSystemBrowser(env = process.env) {
	if (env.PLAYWRIGHT_CHROME_PATH) {
		return env.PLAYWRIGHT_CHROME_PATH;
	}
	const candidates =
		process.platform === 'win32'
			? WINDOWS_CANDIDATES
			: process.platform === 'darwin'
				? MAC_CANDIDATES
				: LINUX_CANDIDATES;
	return candidates.find((candidate) => existsSync(candidate));
}

export async function launchBrowser({ executablePath } = {}) {
	const path = executablePath ?? findSystemBrowser();
	const options = {
		headless: true,
		args: ['--force-device-scale-factor=1', '--hide-scrollbars']
	};
	if (path) {
		options.executablePath = path;
	} else {
		// Last resort: a Playwright-managed Chromium, if one was installed.
		options.channel = 'chrome';
	}
	const browser = await chromium.launch(options);
	return { browser, executablePath: path ?? 'channel:chrome' };
}
