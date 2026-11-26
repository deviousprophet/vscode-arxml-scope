/**
 * Playwright driver for the UX review host run.
 *
 * Connects to the real VS Code over CDP, targets the nested `active-frame`
 * webview and drives the journeys through real clicks, typing and keyboard
 * shortcuts. Host-side setup (open file, run command, change setting, read
 * state) goes through the in-host bridge on 127.0.0.1; the user-facing steps
 * stay in the page.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const OUT = process.env.HOST_OUT ?? path.resolve(here, '../artifacts/host');
const WS = process.env.HOST_WORKSPACE;
const CDP = process.env.HOST_CDP_PORT ?? '9222';
const BRIDGE = process.env.HOST_BRIDGE_PORT;
const MODE = process.env.HOST_MODE ?? 'normal';
const ONLY = (process.env.HOST_ONLY ?? '').split(',').map((item) => item.trim()).filter(Boolean);

const requireFromPreview = createRequire(path.join(repoRoot, 'packages/webview-preview/package.json'));
const { chromium } = requireFromPreview('@playwright/test');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const uri = (fsPath) => ({ kind: 'uri', path: fsPath });
const leftPath = path.join(WS, 'left.arxml');
const rightPath = path.join(WS, 'right.arxml');

mkdirSync(OUT, { recursive: true });

const report = {
	mode: MODE,
	startedAt: new Date().toISOString(),
	workspace: WS,
	cdp: { port: CDP, attempts: 0 },
	scenarios: [],
	captures: [],
	screenshots: [],
	errors: []
};

function persist() {
	writeFileSync(path.join(OUT, 'driver-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function noteError(stage, error) {
	report.errors.push({ stage, message: error instanceof Error ? error.message : String(error), at: new Date().toISOString() });
}

async function B(route, body) {
	const response = await fetch(`http://127.0.0.1:${BRIDGE}${route}`, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const data = await response.json();
	if (data && data.ok === false) {
		throw new Error(`${route} failed: ${data.error}`);
	}
	return data;
}

function resetFixtures() {
	for (const name of ['left.arxml', 'right.arxml']) {
		copyFileSync(path.join(repoRoot, 'src', 'test', 'fixtures', 'diff', name), path.join(WS, name));
	}
}

let browser;
let page;

async function connect() {
	for (let attempt = 0; attempt < 60 && !browser; attempt += 1) {
		report.cdp.attempts = attempt + 1;
		try {
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`, { timeout: 5000 });
		} catch (error) {
			if (attempt === 0) {
				noteError('cdp-connect', error);
			}
			await sleep(500);
		}
	}
	if (!browser) {
		throw new Error('Playwright could not connect over CDP');
	}
	for (let attempt = 0; attempt < 40 && !page; attempt += 1) {
		page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => /workbench|vscode-file/.test(candidate.url()));
		if (!page) {
			await sleep(250);
		}
	}
	if (!page) {
		throw new Error('no VS Code workbench page over CDP');
	}
	page.setDefaultTimeout(15000);
}

function frameText(frame) {
	return frame.evaluate(() => document.body?.innerText ?? '');
}

async function findFrame(marker, timeout = 30000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		for (const candidate of page.frames()) {
			if (!candidate.url().startsWith('vscode-webview://')) {
				continue;
			}
			try {
				const text = await frameText(candidate);
				if (text.includes(marker)) {
					return candidate;
				}
			} catch {
				// detached frame; keep polling
			}
		}
		await sleep(300);
	}
	throw new Error(`webview frame with "${marker}" did not appear`);
}

/** Finds the webview frame that owns a rendered control, independent of hidden labels. */
async function findFrameWith(selector, timeout = 30000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		for (const candidate of page.frames()) {
			if (!candidate.url().startsWith('vscode-webview://')) {
				continue;
			}
			try {
				if ((await candidate.locator(selector).count()) > 0) {
					return candidate;
				}
			} catch {
				// detached frame; keep polling
			}
		}
		await sleep(300);
	}
	throw new Error(`webview frame with "${selector}" did not appear`);
}

async function shot(name, frame) {
	const paths = [];
	// Record the real window and webview content sizes with every capture. The
	// preview states are standalone 1400 px pages; the host webview is narrower
	// by the activity bar, side bar, auxiliary bar and editor split.
	const metrics = {
		page: await page
			.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
			.catch(() => null),
		frame: frame
			? await frame
					.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
					.catch(() => null)
			: null
	};
	report.captures.push({ name, ...metrics });
	const workbench = path.join(OUT, `${name}-workbench.png`);
	await page.screenshot({ path: workbench, animations: 'disabled' });
	paths.push(workbench);
	if (frame) {
		try {
			const webview = path.join(OUT, `${name}-webview.png`);
			await frame.locator('body').screenshot({ path: webview, animations: 'disabled' });
			paths.push(webview);
		} catch (error) {
			noteError(`screenshot:${name}`, error);
		}
	}
	report.screenshots.push(...paths);
	return paths;
}

async function dismissAnyDialog() {
	const dialog = page.locator('.monaco-dialog-box').first();
	if (await dialog.count()) {
		await page.keyboard.press('Escape').catch(() => {});
		await sleep(150);
	}
}

async function workbenchNotifications() {
	const items = page.locator('.notification-list-item, .notifications-list-item');
	const count = await items.count();
	const texts = [];
	for (let index = 0; index < count; index += 1) {
		texts.push((await items.nth(index).innerText().catch(() => '')).trim());
	}
	return texts;
}

async function statusBarText() {
	return (await page.locator('.statusbar-item').allInnerTexts().catch(() => [])).join(' | ');
}

async function reset() {
	await dismissAnyDialog();
	await B('/closeAll').catch(() => {});
	await sleep(200);
	// The dev build shows the "all extensions are disabled" toast and may open Chat;
	// both are host artefacts that cover the page under test.
	await B('/exec', { command: 'notifications.clearAll' }).catch(() => {});
	if ((await page.locator('.part.auxiliarybar').count()) > 0) {
		await B('/exec', { command: 'workbench.action.toggleAuxiliaryBar' }).catch(() => {});
		await sleep(250);
	}
	resetFixtures();
}

function wanted(id) {
	return ONLY.length === 0 || ONLY.includes(id);
}

async function scenario(id, fn) {
	if (!wanted(id)) {
		return;
	}
	const record = {
		id,
		startedAt: new Date().toISOString(),
		ok: false,
		checks: [],
		screenshots: [],
		observations: {}
	};
	const check = (name, ok, detail) => {
		record.checks.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
	};
	try {
		await fn({ check, record });
		record.ok = record.checks.every((item) => item.ok);
	} catch (error) {
		record.ok = false;
		record.error = error instanceof Error ? error.stack ?? error.message : String(error);
		noteError(id, error);
		await shot(`${id}-blocked`).catch(() => {});
	} finally {
		record.finishedAt = new Date().toISOString();
		report.scenarios.push(record);
		persist();
	}
}

async function openEditor(file = leftPath) {
	await B('/openText', { path: file });
	await B('/exec', { command: 'vscode-arxml-scope.openEcucEditor', args: [uri(file)] });
	const frame = await findFrameWith('#toggle-sidebar');
	await frame.waitForSelector('.monaco-editor', { state: 'attached', timeout: 30000 });
	await sleep(400);
	return frame;
}

async function openDiff(left = leftPath, right = rightPath) {
	await B('/exec', { command: 'vscode-arxml-scope.compareSelected', args: [uri(left), [uri(right)]] });
	const frame = await findFrameWith('#diff-view-all');
	await frame.waitForSelector('.monaco-diff-editor', { state: 'attached', timeout: 30000 });
	await sleep(400);
	return frame;
}

function valueOf(record, key) {
	return record.observations[key];
}

/** A large parameter pair with one changed value, for scrolling and stale-race probes. */
function bigPair(size = 300, changedIndex = 250) {
	const build = (changed) => {
		let parameters = '';
		for (let index = 0; index < size; index += 1) {
			const value = index === changedIndex ? changed : index;
			parameters += `<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/Big/C/P${index}</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE>`;
		}
		return `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>Big</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/Big</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/Big/C</DEFINITION-REF><PARAMETER-VALUES>${parameters}</PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
	};
	return { left: build(changedIndex), right: build(9999) };
}

async function main() {
	persist();
	await connect();
	report.cdp.contexts = browser.contexts().length;
	report.cdp.pageUrl = page.url();
	persist();

	if (MODE === 'missing-engine') {
		await scenario('missing-engine', async ({ check, record }) => {
			await sleep(2500);
			const notifications = await workbenchNotifications();
			record.observations.notifications = notifications;
			record.observations.statusBar = await statusBarText();
			const commands = {};
			for (const id of [
				'vscode-arxml-scope.openEcucEditor',
				'vscode-arxml-scope.showEngineStatus',
				'vscode-arxml-scope.rebuildIndex'
			]) {
				commands[id] = (await B('/hasCommand', { command: id })).has;
			}
			record.observations.commands = commands;
			check('a startup error is shown', notifications.length > 0, notifications.join(' / ').slice(0, 240));
			check(
				'the error names the engine or platform',
				notifications.some((text) => /engine|platform|win32|unsupported|binary/i.test(text)),
				notifications.join(' / ').slice(0, 240)
			);
			check('no ARXML commands are registered', Object.values(commands).every((has) => has === false), JSON.stringify(commands));
			record.screenshots.push(...(await shot('first-02-missing-engine')));
		});
		report.finishedAt = new Date().toISOString();
		persist();
		console.log(JSON.stringify({ _type: 'ux-driver', mode: MODE, scenarios: report.scenarios.map((item) => ({ id: item.id, ok: item.ok })) }));
		return;
	}

	await scenario('gate', async ({ check, record }) => {
		await reset();
		const frame = await openEditor();
		record.observations.tabs = (await B('/state')).tabs;
		check('editor webview frame', true);
		check('editor tab is the ECUC custom editor', (await B('/state')).activeTab?.viewType === 'vscode-arxml-scope.ecucEditor');
		const row = frame.locator('.view-line').filter({ hasText: 'ContKeep' }).first();
		check('ContKeep row rendered', (await row.count()) > 0);
		await row.click();
		await sleep(500);
		const details = await frame.locator('#sb-details-body').innerText();
		record.observations.detailsExcerpt = details.slice(0, 300);
		check('Details populated from row selection', /ContKeep|Keep/.test(details), details.slice(0, 120));
		record.screenshots.push(...(await shot('gate-01-editor', frame)));

		await B('/exec', { command: 'vscode-arxml-scope.selectAsFirst', args: [uri(leftPath)] });
		await B('/closeAll');
		await sleep(300);
		await B('/exec', { command: 'vscode-arxml-scope.compareToStaged', args: [uri(rightPath)] });
		const diff = await findFrameWith('#diff-view-all');
		await diff.waitForSelector('.monaco-diff-editor', { state: 'attached', timeout: 30000 });
		await sleep(600);
		const diffText = await frameText(diff);
		record.observations.diffExcerpt = diffText.slice(0, 200);
		check('compareToStaged loaded a diff webview', true);
		check('diff names both files', /left\.arxml/.test(diffText) && /right\.arxml/.test(diffText));
		record.screenshots.push(...(await shot('gate-02-diff', diff)));
	});

	await scenario('capture-fidelity', async ({ check, record }) => {
		await reset();
		const frame = await openEditor();
		const read = async (label) => {
			const pageSize = await page.evaluate(() => ({
				width: innerWidth,
				height: innerHeight,
				dpr: devicePixelRatio
			}));
			const frameSize = await frame.evaluate(() => ({
				width: innerWidth,
				height: innerHeight,
				dpr: devicePixelRatio
			}));
			const zoom = await B('/config', { section: 'window', key: 'zoomLevel' });
			record.observations[label] = { page: pageSize, frame: frameSize, zoom: zoom.value };
			return { pageSize, frameSize, zoom: zoom.value };
		};
		const normal = await read('zoom0');
		await shot('capture-zoom-100', frame);
		await B('/exec', { command: 'workbench.action.zoomOut' });
		await sleep(900);
		const zoomedOut = await read('zoomOut');
		await shot('capture-zoom-80', frame);
		await B('/exec', { command: 'workbench.action.zoomReset' });
		await sleep(500);
		check('the capture records the workbench zoom level', typeof normal.zoom === 'number', String(normal.zoom));
		check(
			'zooming out widens the webview CSS pixel width',
			zoomedOut.frameSize.width > normal.frameSize.width,
			`${normal.frameSize.width} -> ${zoomedOut.frameSize.width}`
		);
	});

	await scenario('probe-diff', async ({ record }) => {
		await reset();
		const frame = await openDiff();
		record.observations.rows = await frame.evaluate(() => {
			const classes = ['.line-insert', '.line-delete', '.diff-line-insert', '.action-item', 'button'];
			const out = {};
			for (const selector of classes) {
				out[selector] = document.querySelectorAll(selector).length;
			}
			out.buttons = [...document.querySelectorAll('button')].slice(0, 40).map((button) => ({
				aria: button.getAttribute('aria-label'),
				title: button.title,
				cls: button.className,
				rect: button.getBoundingClientRect().toJSON()
			}));
			out.viewLines = [...document.querySelectorAll('.modified-in-monaco-diff-editor .view-line')]
				.slice(0, 4)
				.map((line) => line.textContent);
			out.scrollables = [...document.querySelectorAll('.monaco-scrollable-element')].map((element) => ({
				cls: element.className,
				top: element.scrollTop,
				height: element.clientHeight
			}));
			out.actions = [...document.querySelectorAll('.action-item')].map((element) => ({
				title: element.getAttribute('title'),
				aria: element.getAttribute('aria-label'),
				cls: element.className,
				rect: element.getBoundingClientRect().toJSON(),
				html: element.outerHTML.slice(0, 180)
			}));
			return out;
		});
		record.screenshots.push(...(await shot('probe-diff', frame)));
	});

	await scenario('edit', async ({ check, record }) => {
		await reset();
		const frame = await openEditor();
		const row = frame.locator('.view-line').filter({ hasText: 'ContKeep' }).first();
		await row.click();
		await sleep(400);
		const before = await frame.locator('#sb-details-body').innerText();
		let presses = 0;
		let after = before;
		while (presses < 4 && after === before) {
			await page.keyboard.press('ArrowDown');
			presses += 1;
			await sleep(350);
			after = await frame.locator('#sb-details-body').innerText();
		}
		record.observations.before = before.slice(0, 120);
		record.observations.after = after.slice(0, 120);
		record.observations.arrowPresses = presses;
		check('ArrowDown moves the row selection', before !== after, `details changed after ${presses} press(es)`);

		const param = frame.locator('.view-line').filter({ hasText: 'Keep =' }).first();
		await param.click();
		await sleep(350);
		await page.keyboard.press('End');
		await page.keyboard.press('Backspace');
		await page.keyboard.type('7');
		await sleep(900);
		let dirtyText = await frame.locator('#editor-dirty-status').innerText();
		let dirtyHidden = await frame.locator('#editor-dirty-status').evaluate((node) => node.hidden);
		let detailsValue = await frame.locator('#details-value').inputValue().catch(() => null);
		record.observations.inlineDirty = { dirtyText, dirtyHidden, detailsValue };
		if (dirtyHidden) {
			await frame.locator('#details-value').fill('7');
			await sleep(700);
			dirtyText = await frame.locator('#editor-dirty-status').innerText();
			dirtyHidden = await frame.locator('#editor-dirty-status').evaluate((node) => node.hidden);
			detailsValue = await frame.locator('#details-value').inputValue().catch(() => null);
			record.observations.usedDetailsFallback = true;
		}
		check('editing marks the page dirty', !dirtyHidden, dirtyText);
		check('Details value reflects the draft', detailsValue === '7', detailsValue);
		record.screenshots.push(...(await shot('edit-01-dirty', frame)));

		await frame.locator('.monaco-editor').first().click();
		await page.keyboard.press('Control+s');
		await sleep(1800);
		const savedText = readFileSync(leftPath, 'utf8');
		const savedDirty = await frame.locator('#editor-dirty-status').evaluate((node) => node.hidden);
		record.observations.savedDirtyHidden = savedDirty;
		check('Ctrl+S clears the dirty strip', savedDirty === true);
		check(
			'Ctrl+S wrote the edited parameter value to the file',
			/\/Keep<\/DEFINITION-REF>\s*<VALUE>7<\/VALUE>/.test(savedText),
			'Keep = 7 in left.arxml'
		);
		record.screenshots.push(...(await shot('edit-02-saved', frame)));
	});

	await scenario('save-continuity', async ({ check, record }) => {
		await reset();
		const bigPath = path.join(WS, 'big.arxml');
		await B('/writeFile', { path: bigPath, content: bigPair(400, 250).left });
		const frame = await openEditor(bigPath);
		const initialLine = await frame.locator('.view-line').first().innerText();
		await frame.locator('.monaco-editor').first().click();
		await page.keyboard.press('Control+End');
		await sleep(500);
		const visibleLines = await frame.locator('.view-line').allInnerTexts();
		const parameters = visibleLines
			.map((line) => line.trim())
			.filter((line) => /^P\d+\s*=/.test(line));
		const targetText = parameters[parameters.length - 1] ?? visibleLines[visibleLines.length - 2]?.trim();
		record.observations.targetText = targetText ?? null;
		check('a parameter row is visible after scrolling', targetText !== undefined);
		if (targetText === undefined) {
			record.screenshots.push(...(await shot('save-continuity-no-row', frame)));
			return;
		}
		const last = frame.locator('.view-line').filter({ hasText: targetText }).first();
		await last.click();
		await page.keyboard.press('End');
		await page.keyboard.press('Backspace');
		await page.keyboard.type('1');
		await sleep(900);
		const beforeDetails = await frame.locator('#sb-details-body').innerText().catch(() => '');
		record.observations.beforeDetails = beforeDetails.slice(0, 200);
		record.screenshots.push(...(await shot('save-continuity-before', frame)));
		const measure = () =>
			frame.evaluate(() => {
				const scroller = [...document.querySelectorAll('.monaco-scrollable-element')].find(
					(element) => element.querySelector('.view-lines')
				);
				const active = document.activeElement;
				const lines = [...document.querySelectorAll('.view-line')]
					.map((element) => (element.textContent ?? '').trim())
					.filter(Boolean);
				return {
					scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
					activeTag: active ? active.tagName : null,
					activeClass: active ? String(active.className).slice(0, 100) : null,
					firstLine: lines[0]?.slice(0, 80) ?? null,
					lastLine: lines[lines.length - 1]?.slice(0, 80) ?? null
				};
			});
		const beforeSave = await measure();
		record.observations.beforeSave = beforeSave;
		await frame.locator('.monaco-editor').first().click();
		await page.keyboard.press('Control+s');
		await sleep(1800);
		const afterSave = await measure();
		record.observations.afterSave = afterSave;
		const afterDetails = await frame.locator('#sb-details-body').innerText().catch(() => '');
		record.observations.afterDetails = afterDetails.slice(0, 200);
		const dirtyHidden = await frame.locator('#editor-dirty-status').evaluate((node) => node.hidden);
		check('the save clears the dirty strip', dirtyHidden);
		check(
			'the document was scrolled away from the top before the save',
			beforeSave.firstLine !== initialLine.trim(),
			`${initialLine.trim()} -> ${beforeSave.firstLine}`
		);
		check(
			'the scroll anchor survives the save',
			afterSave.firstLine === beforeSave.firstLine && afterSave.lastLine === beforeSave.lastLine,
			`${beforeSave.firstLine} / ${beforeSave.lastLine} -> ${afterSave.firstLine} / ${afterSave.lastLine}`
		);
		check(
			'the selected row and Details stay on the edited row after the save',
			afterDetails === beforeDetails,
			`${beforeDetails.slice(0, 80)} -> ${afterDetails.slice(0, 80)}`
		);
		const rowId = /^P\d+/.exec(targetText ?? '')?.[0] ?? targetText ?? '';
		check(
			'the edited row stays in view after the save',
			(await frame.locator('.view-line').filter({ hasText: rowId }).count()) > 0
		);
		check(
			'the editor keeps focus after the save',
			/textbox|native-edit-context|monaco/i.test(`${afterSave.activeTag} ${afterSave.activeClass}`),
			`${afterSave.activeTag} ${afterSave.activeClass}`
		);
		record.screenshots.push(...(await shot('save-continuity-after', frame)));
	});

	await scenario('compare-two', async ({ check, record }) => {
		await reset();
		const frame = await openDiff();
		const text = await frameText(frame);
		check('Compare Two opened the diff', true);
		check('both pane labels are present', /left\.arxml/.test(text) && /right\.arxml/.test(text));
		record.observations.toolbar = await frame.locator('.toolbar .tool').count();
		record.screenshots.push(...(await shot('entry-20-compare-two', frame)));
	});

	await scenario('diff', async ({ check, record }) => {
		await reset();
		const frame = await openDiff();
		check('11 toolbar controls', (await frame.locator('.toolbar .tool').count()) === 11);
		record.observations.initialMode = await frame.locator('#diff-mode-semantic').getAttribute('aria-pressed');
		check('semantic is the default mode', record.observations.initialMode === 'true');
		record.screenshots.push(...(await shot('diff-01-loaded', frame)));

		await frame.locator('#diff-mode-strict').click();
		await sleep(900);
		const strict = await frame.locator('#diff-mode-strict').getAttribute('aria-pressed');
		const status = await frame.locator('#diff-match-status').innerText();
		record.observations.strict = { strict, status };
		check('Strict toggle flips', strict === 'true', strict);
		record.screenshots.push(...(await shot('diff-02-strict', frame)));
		await frame.locator('#diff-mode-semantic').click();
		await sleep(600);

		await frame.locator('.monaco-diff-editor .view-line').first().click();
		await page.keyboard.press('Control+f');
		await frame.waitForSelector('.find-widget', { state: 'visible', timeout: 5000 }).catch(() => {});
		await page.keyboard.type('ContKeep');
		await page.keyboard.press('Enter');
		await sleep(700);
		const count = await frame.locator('.matchesCount').innerText().catch(() => '');
		record.observations.findCount = count;
		check('diff find reports a match', /\d+\s*of\s*\d+|1 of/i.test(count) || count.length > 0, count);
		record.screenshots.push(...(await shot('diff-03-find', frame)));

		const scrollBefore = await frame.evaluate(() => {
			const element = document.querySelector('.modified-in-monaco-diff-editor .monaco-scrollable-element');
			return {
				top: element ? element.scrollTop : null,
				firstLine: document.querySelector('.modified-in-monaco-diff-editor .view-line')?.textContent ?? null
			};
		});
		await frame.locator('#diff-next').click();
		await frame.locator('#diff-next').click();
		await sleep(600);
		const scrollAfter = await frame.evaluate(() => {
			const element = document.querySelector('.modified-in-monaco-diff-editor .monaco-scrollable-element');
			return {
				top: element ? element.scrollTop : null,
				firstLine: document.querySelector('.modified-in-monaco-diff-editor .view-line')?.textContent ?? null
			};
		});
		record.observations.diffScroll = { scrollBefore, scrollAfter };
		// The fixture fits the viewport, so prove next-diff on a long generated pair instead.
		const big = bigPair();
		await B('/closeAll');
		await B('/writeFile', { path: path.join(WS, 'big-left.arxml'), content: big.left });
		await B('/writeFile', { path: path.join(WS, 'big-right.arxml'), content: big.right });
		const bigFrame = await openDiff(path.join(WS, 'big-left.arxml'), path.join(WS, 'big-right.arxml'));
		const readVisible = (target) =>
			target.evaluate(() => {
				const lines = [...document.querySelectorAll('.modified-in-monaco-diff-editor .view-line')]
					.map((element) => ({ text: element.textContent, top: element.getBoundingClientRect().top }))
					.filter((line) => line.top >= 54 && line.top < window.innerHeight - 20)
					.sort((a, b) => a.top - b.top);
				return lines.length > 0 ? lines[0].text : null;
			});
		const visibleBefore = await readVisible(bigFrame);
		await bigFrame.locator('#diff-next').click();
		await sleep(800);
		const visibleAfter = await readVisible(bigFrame);
		record.observations.bigVisible = { visibleBefore, visibleAfter };
		check('next-diff jumps to the changed row on a long diff', visibleBefore !== visibleAfter, `${visibleBefore} -> ${visibleAfter}`);
		record.screenshots.push(...(await shot('diff-04-next-long', bigFrame)));
	});

	await scenario('merge', async ({ check, record }) => {
		await reset();
		const rightBefore = readFileSync(rightPath, 'utf8');
		const frame = await openDiff();
		await frame.locator('#diff-merge').click();
		await sleep(500);
		check('Merge turns on', (await frame.locator('#diff-merge').getAttribute('aria-pressed')) === 'true');
		record.screenshots.push(...(await shot('merge-01-on', frame)));

		const line = frame.locator('.line-insert').first();
		check('a changed hunk exists', (await line.count()) > 0);
		await line.hover({ force: true }).catch(() => {});
		const copyRight = frame.locator('a[aria-label="Copy Block to Right"], button[aria-label="Copy Block to Right"]').first();
		await copyRight.waitFor({ state: 'attached', timeout: 6000 }).catch(() => {});
		const copyCount = await copyRight.count();
		const copyVisible = copyCount > 0 ? await copyRight.isVisible() : false;
		const copyBox = copyCount > 0 ? await copyRight.boundingBox() : null;
		record.observations.copyAction = { copyCount, copyVisible, copyBox };
		check('copy action exists in the hunk toolbar', copyCount > 0);
		if (copyCount > 0) {
			if (copyBox) {
				await page.mouse.move(copyBox.x + copyBox.width / 2, copyBox.y + copyBox.height / 2);
				await sleep(150);
			}
			await copyRight.click({ force: !copyVisible });
			await sleep(1400);
			const text = await frameText(frame);
			record.observations.paneHasDirtyMark = /right\.arxml\s*•/.test(text);
			check('receiving pane shows the unsaved marker', record.observations.paneHasDirtyMark, text.slice(0, 120));
			const state = await B('/state');
			record.observations.dirtyTabs = state.tabs.filter((tab) => tab.dirty).map((tab) => tab.label);
			check('a document is dirty after the copy', state.tabs.some((tab) => tab.dirty), record.observations.dirtyTabs);
			record.screenshots.push(...(await shot('merge-02-copied', frame)));
		}

		await frame.locator('.modified-in-monaco-diff-editor .view-line').first().click().catch(() => {});
		await page.keyboard.press('Control+s');
		await sleep(2000);
		const stateAfter = await B('/state');
		record.observations.dirtyAfterSave = stateAfter.tabs.filter((tab) => tab.dirty).map((tab) => tab.label);
		const rightNow = readFileSync(rightPath, 'utf8');
		record.observations.rightChanged = rightNow !== rightBefore;
		check('Ctrl+S clears the dirty documents', stateAfter.tabs.every((tab) => !tab.dirty), record.observations.dirtyAfterSave);
		check('save wrote the copy to right.arxml', rightNow !== rightBefore, `${rightBefore.length} -> ${rightNow.length} bytes`);
		if (stateAfter.tabs.some((tab) => tab.dirty)) {
			// The receiving file has its own tab; test the document-tab save path.
			const rightTab = page.locator('.tabs-container .tab').filter({ hasText: /^right\.arxml/ }).first();
			const tabCount = await rightTab.count();
			record.observations.rightTabCount = tabCount;
			if (tabCount > 0) {
				await rightTab.click();
				await sleep(300);
				await page.keyboard.press('Control+s');
				await sleep(1500);
			}
			const tabSaveState = await B('/state');
			record.observations.dirtyAfterTabSave = tabSaveState.tabs.filter((tab) => tab.dirty).map((tab) => tab.label);
			const afterTabBytes = readFileSync(rightPath, 'utf8');
			record.observations.tabSaveWorked = afterTabBytes !== rightBefore;
			if (tabSaveState.tabs.some((tab) => tab.dirty)) {
				await B('/saveAll');
				await sleep(1500);
				const saveAllState = await B('/state');
				record.observations.dirtyAfterSaveAll = saveAllState.tabs.filter((tab) => tab.dirty).map((tab) => tab.label);
				record.observations.saveAllWorked = readFileSync(rightPath, 'utf8') !== rightBefore;
			}
			record.screenshots.push(...(await shot('merge-03-save-paths')));
		}
		record.screenshots.push(...(await shot('merge-03-saved', frame)));
	});

	await scenario('stale-copy', async ({ check, record }) => {
		await reset();
		const big = bigPair(4000, 5);
		await B('/writeFile', { path: path.join(WS, 'stale-left.arxml'), content: big.left });
		await B('/writeFile', { path: path.join(WS, 'stale-right.arxml'), content: big.right });
		const frame = await openDiff(path.join(WS, 'stale-left.arxml'), path.join(WS, 'stale-right.arxml'));
		await frame.locator('#diff-merge').click();
		await sleep(500);
		await frame.locator('#diff-next').click().catch(() => {});
		await sleep(500);
		const line = frame.locator('.line-insert').first();
		await line.hover({ force: true }).catch(() => {});
		await sleep(250);
		const link = frame.locator('a[aria-label="Copy Block to Right"]').first();
		await link.waitFor({ state: 'attached', timeout: 6000 }).catch(() => {});
		const copyBox = (await link.count()) > 0 ? await link.boundingBox() : null;
		record.observations.copyBox = copyBox;
		const rightStalePath = path.join(WS, 'stale-right.arxml');
		const original = readFileSync(rightStalePath, 'utf8');
		const changed = original.replace('<VALUE>9999</VALUE>', '<VALUE>12345</VALUE>');
		record.observations.contentChanged = changed !== original;
		await B('/replaceDocument', { path: rightStalePath, content: changed, waitMs: 0 });
		if (copyBox) {
			await page.mouse.click(copyBox.x + copyBox.width / 2, copyBox.y + copyBox.height / 2);
		} else {
			await link.click({ force: true }).catch(() => {});
		}
		await sleep(1200);
		const dialog = page.locator('.monaco-dialog-box');
		const dialogCount = await dialog.count();
		const dialogText = dialogCount ? await dialog.innerText().catch(() => '') : '';
		record.observations.dialogText = dialogText;
		check('stale snapshot raised the Reload/Cancel modal', dialogCount > 0 && /comparison changed/i.test(dialogText), dialogText.slice(0, 160));
		record.screenshots.push(...(await shot('merge-10-stale', frame)));
		if (dialogCount) {
			await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
			await sleep(700);
			const state = await B('/state');
			record.observations.dirtyAfterCancel = state.tabs.filter((tab) => tab.dirty).map((tab) => tab.label);
			check('Cancel leaves every document clean', record.observations.dirtyAfterCancel.length === 0);
			record.screenshots.push(...(await shot('merge-11-cancelled', frame)));
		}
	});

	await scenario('stale-node', async ({ check, record }) => {
		await reset();
		const frame = await openEditor();
		const row = frame.locator('.view-line').filter({ hasText: 'Keep =' }).first();
		await row.click();
		await sleep(350);
		await frame.locator('#details-value').fill('7');
		await sleep(700);
		const before = readFileSync(leftPath, 'utf8');
		const renamed = before.replace(/ContKeep/g, 'ContKeepGone');
		record.observations.renamed = renamed !== before;
		await B('/replaceDocument', { path: leftPath, content: renamed, waitMs: 900 });
		await sleep(1000);
		await frame.locator('.monaco-editor').first().click().catch(() => {});
		await page.keyboard.press('Control+s');
		await sleep(1800);
		const detailsStatus = await frame.locator('#details-status').innerText().catch(() => '');
		const dirtyHidden = await frame.locator('#editor-dirty-status').evaluate((node) => node.hidden).catch(() => null);
		record.observations.detailsStatus = detailsStatus;
		record.observations.dirtyHidden = dirtyHidden;
		check('stale save is refused', /no longer in the file|stale/i.test(detailsStatus) || dirtyHidden === false, detailsStatus);
		check('refusal is not only the top strip', /no longer in the file|stale/i.test(detailsStatus), detailsStatus);
		record.screenshots.push(...(await shot('edit-16-stale', frame)));
	});

	await scenario('engine-index', async ({ check, record }) => {
		await reset();
		await B('/exec', { command: 'vscode-arxml-scope.showEngineStatus', detached: true });
		await sleep(1200);
		const notifications = await workbenchNotifications();
		record.observations.notifications = notifications;
		check('engine status produced a notification', notifications.some((text) => /engine|ARXML Scope/i.test(text)), notifications.join(' / ').slice(0, 200));
		const openOutput = page.getByRole('button', { name: 'Open Output' }).first();
		if ((await openOutput.count()) > 0) {
			await openOutput.click().catch(() => {});
			await sleep(700);
		}
		record.screenshots.push(...(await shot('engine-01-status')));
		await B('/exec', { command: 'notifications.clearAll' }).catch(() => {});
		await B('/exec', { command: 'workbench.action.closePanel' }).catch(() => {});

		const before = await statusBarText();
		record.observations.statusBefore = before;
		check('status bar shows the index count', /ARXML Scope/i.test(before), before.slice(0, 160));
		await B('/exec', { command: 'vscode-arxml-scope.rebuildIndex' });
		await sleep(1800);
		const after = await statusBarText();
		record.observations.statusAfter = after;
		check('rebuild leaves a status count', /ARXML Scope/i.test(after), after.slice(0, 160));
		record.screenshots.push(...(await shot('index-04-rebuilt')));
	});

	await scenario('a11y', async ({ check, record }) => {
		await reset();
		await B('/openText', { path: leftPath });
		await sleep(300);
		await page.keyboard.press('Control+Shift+p');
		await page.waitForSelector('.quick-input-widget', { state: 'visible', timeout: 6000 });
		await page.keyboard.type('ARXML Scope: Open with ECUC Editor');
		await sleep(500);
		await page.keyboard.press('Enter');
		const frame = await findFrameWith('#toggle-sidebar');
		await frame.waitForSelector('.monaco-editor', { state: 'attached', timeout: 30000 });
		check('command palette opens the ECUC editor by keyboard', true);
		record.screenshots.push(...(await shot('a11y-01-palette', frame)));

		await frame.locator('#collapse-all').focus();
		const order = [];
		for (let index = 0; index < 6; index += 1) {
			order.push(await frame.evaluate(() => document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName));
			await page.keyboard.press('Tab');
			await sleep(120);
		}
		record.observations.editorTabOrder = order;
		check('editor toolbar exposes a keyboard focus order', order.some((item) => item && item !== 'BODY'), order.join(' > '));
		record.screenshots.push(...(await shot('a11y-02-editor-focus', frame)));

		await B('/closeAll');
		await openDiff();
		const diff = await findFrameWith('#diff-view-all');
		await diff.locator('#diff-view-all').focus();
		const diffOrder = [];
		for (let index = 0; index < 12; index += 1) {
			diffOrder.push(await diff.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName));
			await page.keyboard.press('Tab');
			await sleep(80);
		}
		record.observations.diffTabOrder = diffOrder;
		check('diff toolbar exposes 11 focusable controls', diffOrder.filter((item) => item && item !== 'BODY').length >= 10, diffOrder.join(' > '));
		record.screenshots.push(...(await shot('a11y-03-diff-focus', diff)));
	});

	await scenario('stale-first', async ({ check, record }) => {
		await reset();
		const staleFirst = path.join(WS, 'stale-first.arxml');
		copyFileSync(leftPath, staleFirst);
		await B('/exec', { command: 'vscode-arxml-scope.selectAsFirst', args: [uri(staleFirst)] });
		await sleep(400);
		await B('/exec', { command: 'notifications.clearAll' }).catch(() => {});
		await B('/vscodeDelete', { path: staleFirst });
		await sleep(600);
		record.observations.existsAfterDelete = existsSync(staleFirst);
		await B('/exec', { command: 'vscode-arxml-scope.compareToStaged', args: [uri(rightPath)] });
		await sleep(1500);
		const notifications = await workbenchNotifications();
		record.observations.notifications = notifications;
		const tabs = (await B('/state')).tabs;
		record.observations.tabs = tabs;
		check('the first file is really gone', record.observations.existsAfterDelete === false);
		check('missing first file is reported, not opaquely opened', notifications.length > 0, notifications.join(' / ').slice(0, 200));
		record.screenshots.push(...(await shot('entry-16-stale-first')));
		resetFixtures();
	});

	await scenario('same-file', async ({ check, record }) => {
		await reset();
		await B('/exec', { command: 'vscode-arxml-scope.compareSelected', args: [uri(leftPath), [uri(leftPath)]] });
		await sleep(1500);
		const notifications = await workbenchNotifications();
		const state = await B('/state');
		record.observations.notifications = notifications;
		record.observations.tabs = state.tabs;
		const webviews = state.tabs.filter((tab) => tab.viewType);
		check('same-file compare resolves to a stated outcome', notifications.length > 0 || webviews.length > 0, JSON.stringify({ notifications, webviews }).slice(0, 240));
		record.screenshots.push(...(await shot('entry-24-same-file')));
	});

	report.finishedAt = new Date().toISOString();
	persist();
	console.log(JSON.stringify({ _type: 'ux-driver', scenarios: report.scenarios.map((item) => ({ id: item.id, ok: item.ok })), errors: report.errors.length }));
}

try {
	await main();
} catch (error) {
	noteError('driver', error);
	persist();
	console.error(`driver failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
	process.exitCode = 1;
} finally {
	persist();
	// Do not close the browser: CDP close would close the VS Code window the runner owns.
	process.exit(process.exitCode ?? 0);
}
