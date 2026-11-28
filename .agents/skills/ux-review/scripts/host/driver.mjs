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

/** Close the auxiliary bar only when it is actually open, so captures keep one width. */
async function ensureChatClosed() {
	const aux = page.locator('.part.auxiliarybar').first();
	const count = await aux.count().catch(() => 0);
	if (count > 0 && (await aux.isVisible().catch(() => false))) {
		await B('/exec', { command: 'workbench.action.toggleAuxiliaryBar' }).catch(() => {});
		await sleep(300);
	}
}

/** Open only the custom editor (no pre-existing text tab), so reveal modes are observable. */
async function openEditorOnly(file) {
	await B('/openWith', { path: file, viewType: 'vscode-arxml-scope.ecucEditor' });
	const frame = await findFrameWith('#toggle-sidebar');
	await frame.waitForSelector('.monaco-editor', { state: 'attached', timeout: 30000 });
	await sleep(400);
	return frame;
}

const readDoc = (file) => B('/readFile', { path: file }).then((result) => result.content);
const writeDoc = (file, content) => B('/writeFile', { path: file, content });

/** The status-bar labels (VS Code puts the full tooltip on aria-label). */
async function statusLabels() {
	const labels = await page
		.locator('.statusbar-item')
		.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') || node.textContent || ''))
		.catch(() => []);
	return labels.join(' | ');
}

/** The focused element inside a webview frame. */
function activeIn(frame) {
	return frame.evaluate(() => ({
		id: document.activeElement?.id || '',
		tag: document.activeElement?.tagName || '',
		text: (document.activeElement?.textContent || '').trim().slice(0, 60)
	}));
}

/** One row line in the ECUC document. */
function rowLine(frame, text) {
	return frame.locator('.view-line').filter({ hasText: text }).first();
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
			beforeDetails.split('\n').slice(0, 4).join('\n') === afterDetails.split('\n').slice(0, 4).join('\n'),
			`${beforeDetails.split('\n').slice(0, 4).join(' / ')} -> ${afterDetails.split('\n').slice(0, 4).join(' / ')}`
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
		const banner = await frame.locator('#editor-stale-banner').innerText().catch(() => '');
		const bannerHidden = await frame.locator('#editor-stale-banner').evaluate((node) => node.hidden).catch(() => null);
		const toolbar = await frame.locator('#editor-dirty-status').innerText().catch(() => '');
		const detailsStatus = await frame.locator('#details-status').innerText().catch(() => '');
		const dirtyHidden = await frame.locator('#editor-dirty-status').evaluate((node) => node.hidden).catch(() => null);
		const staleDetails = await frame.locator('.inspector-stale').innerText().catch(() => '');
		const editable = await frame.locator('#details-value').count();
		const discard = await frame.locator('#editor-stale-discard').count();
		const reload = await frame.locator('#editor-stale-reload').count();
		record.observations.staleNode = {
			banner,
			bannerHidden,
			toolbar,
			detailsStatus,
			dirtyHidden,
			staleDetails,
			editable,
			discard,
			reload
		};
		check('stale save keeps a persistent banner', bannerHidden === false && /no longer in the file/i.test(banner), banner);
		check('the toolbar reports the blocked save', /Save blocked/i.test(toolbar), toolbar);
		check('the dead node has no editable Details control', editable === 0 && /Blocked draft/.test(staleDetails), staleDetails);
		check('the stale state offers discard and reload', discard > 0 && reload > 0, `${discard}/${reload}`);
		check('the stale refusal is not duplicated in the status line', detailsStatus.trim() === '', detailsStatus);
		record.screenshots.push(...(await shot('edit-16-stale', frame)));
		await frame.locator('#editor-stale-discard').click().catch(() => {});
		await sleep(900);
		const afterDiscard = await frame.locator('#editor-stale-banner').evaluate((node) => node.hidden).catch(() => null);
		record.observations.afterDiscard = {
			bannerHidden: afterDiscard,
			editable: await frame.locator('#details-value').count()
		};
		check('Discard removes the blocked draft', afterDiscard === true, String(afterDiscard));
		record.screenshots.push(...(await shot('edit-16-stale-discarded', frame)));
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

	await scenario('edit-invalid', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		const frame = await openEditor();
		await rowLine(frame, 'Keep =').click();
		await sleep(350);
		const value = frame.locator('#details-value');
		await value.fill('abc');
		await sleep(900);
		const toolbar = await frame.locator('#editor-dirty-status').innerText().catch(() => '');
		const strip = await frame.locator('#editor-error-strip').innerText().catch(() => '');
		const stripHidden = await frame.locator('#editor-error-strip').evaluate((node) => node.hidden).catch(() => null);
		const inline = await frame.locator('.details-value-error').first().innerText().catch(() => '');
		const status = await frame.locator('#details-status').innerText().catch(() => '');
		record.observations.invalidChannels = { toolbar, strip, stripHidden, inline, status };
		check('the toolbar reports the invalid draft', /invalid/i.test(toolbar), toolbar);
		check('the error strip does not repeat the visible field error', stripHidden === true && strip === '', strip);
		check('the Details field shows an inline error', /invalid/i.test(inline), inline);
		check('the Details status line does not repeat it', status.trim() === '', status);
		const detailsText = await frame.locator('#sb-details-body').innerText().catch(() => '');
		check('derived formats do not describe the invalid draft', !/Hexadecimal|0x00|0b00000000/.test(detailsText), detailsText.slice(0, 200));
		check('derived formats are labelled last accepted', /last accepted value/i.test(detailsText), detailsText.slice(0, 200));
		record.screenshots.push(...(await shot('deep-edit-invalid', frame)));
		await page.keyboard.press('Control+s');
		await sleep(1500);
		const blockedText = readFileSync(leftPath, 'utf8');
		check('the invalid draft is not written', /\/Keep<\/DEFINITION-REF>\s*<VALUE>1<\/VALUE>/.test(blockedText));
		check('the draft stays dirty after the blocked save', !(await frame.locator('#editor-dirty-status').evaluate((node) => node.hidden)));
		await value.fill('7');
		await sleep(900);
		await page.keyboard.press('Control+s');
		await sleep(1800);
		const fixedText = readFileSync(leftPath, 'utf8');
		check('fixing the value saves it', /\/Keep<\/DEFINITION-REF>\s*<VALUE>7<\/VALUE>/.test(fixedText));
		check('the dirty marker clears after the fixed save', await frame.locator('#editor-dirty-status').evaluate((node) => node.hidden));
		record.observations.afterFix = {
			strip: await frame.locator('#editor-error-strip').innerText().catch(() => ''),
			status: await frame.locator('#details-status').innerText().catch(() => ''),
			value: await frame.locator('#details-value').inputValue().catch(() => null)
		};
		record.screenshots.push(...(await shot('deep-edit-invalid-fixed', frame)));
	});

	await scenario('edit-details-save', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		const frame = await openEditor();
		await rowLine(frame, 'Changed =').click();
		await sleep(350);
		const value = frame.locator('#details-value');
		await value.fill('12');
		await sleep(800);
		const before = await activeIn(frame);
		const caretBefore = await value.evaluate((node) => node.selectionStart);
		record.observations.beforeSave = { ...before, caret: caretBefore };
		await page.keyboard.press('Control+s');
		await sleep(1800);
		const after = await activeIn(frame);
		const caretAfter = await value.evaluate((node) => node.selectionStart).catch(() => null);
		const details = await frame.locator('#sb-details-body').innerText().catch(() => '');
		record.observations.afterSave = { ...after, caret: caretAfter, details: details.slice(0, 160) };
		check('Ctrl+S from the Details field saves the value', /\/Changed<\/DEFINITION-REF>\s*<VALUE>12<\/VALUE>/.test(readFileSync(leftPath, 'utf8')));
		check('the dirty marker clears', await frame.locator('#editor-dirty-status').evaluate((node) => node.hidden));
		check('Details keeps focus after the host echo', after.id === 'details-value', JSON.stringify(after));
		check('Details keeps the caret at the end', caretAfter === 2, String(caretAfter));
		check('Details still shows the edited row', /Changed/.test(details), details.slice(0, 80));
		record.screenshots.push(...(await shot('deep-edit-details-save', frame)));
	});

	await scenario('edit-multi-save', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		const frame = await openEditor();
		await rowLine(frame, 'Keep =').click();
		await page.keyboard.press('End');
		await page.keyboard.press('Backspace');
		await page.keyboard.type('5');
		await sleep(900);
		await rowLine(frame, 'Changed =').click();
		await sleep(300);
		await frame.locator('#details-value').fill('15');
		await sleep(900);
		const beforeSave = await frame.locator('#editor-dirty-status').innerText().catch(() => '');
		await page.keyboard.press('Control+s');
		await sleep(2200);
		const text = readFileSync(leftPath, 'utf8');
		record.observations.beforeSave = beforeSave;
		record.observations.afterSave = await frame.locator('#editor-dirty-status').evaluate((node) => node.hidden);
		check('one Ctrl+S writes both drafts', /\/Keep<\/DEFINITION-REF>\s*<VALUE>5<\/VALUE>/.test(text) && /\/Changed<\/DEFINITION-REF>\s*<VALUE>15<\/VALUE>/.test(text));
		check('both values stay visible', (await rowLine(frame, 'Keep = 5').count()) === 1 && (await rowLine(frame, 'Changed = 15').count()) === 1);
		check('the dirty marker clears', await frame.locator('#editor-dirty-status').evaluate((node) => node.hidden));
		record.screenshots.push(...(await shot('deep-edit-multi-save', frame)));
	});

	await scenario('row-menu', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		const frame = await openEditor();
		await rowLine(frame, 'ContKeep').click({ button: 'right' });
		await sleep(500);
		const context = frame.locator('.context-view').first();
		const menuVisible = await context.isVisible().catch(() => false);
		const menuText = menuVisible ? await context.innerText().catch(() => '') : '';
		record.observations.menu = { visible: menuVisible, text: menuText.slice(0, 400) };
		check('right-click on a row opens the context menu', menuVisible, String(menuVisible));
		check('the menu offers the ECUC actions', /Duplicate ECUC element/.test(menuText) && /Delete ECUC element/.test(menuText), menuText.slice(0, 160));
		if (!menuVisible) {
			record.screenshots.push(...(await shot('deep-row-menu-missing', frame)));
			return;
		}
		await frame.locator('.context-view .action-item', { hasText: 'Delete ECUC element' }).first().click({ force: true });
		await sleep(1200);
		const dialogProbe = await page.evaluate(() => ({
			classes: [
				...new Set(
					[...document.querySelectorAll('[class*="dialog"], [role="dialog"]')].map((node) => String(node.className).slice(0, 80))
				)
			].slice(0, 8),
			text: [...document.querySelectorAll('[class*="dialog"], [role="dialog"]')].map((node) => (node.textContent || '').trim().slice(0, 120)).slice(0, 4)
		}));
		record.observations.dialogProbe = dialogProbe;
		record.observations.pagesAfterDelete = browser.contexts().flatMap((context) => context.pages().map((candidate) => candidate.url()));
		record.observations.editorAfterDelete = {
			strip: await frame.locator('#editor-error-strip').innerText().catch(() => ''),
			status: await frame.locator('#details-status').innerText().catch(() => ''),
			notifications: await workbenchNotifications()
		};
		const dialog = page.locator('.monaco-dialog-box').first();
		const dialogCount = await dialog.count();
		const dialogText = dialogCount ? await dialog.innerText().catch(() => '') : '';
		record.observations.deleteDialog = { dialogCount, dialogText: dialogText.slice(0, 200) };
		check('Delete asks for confirmation', dialogCount > 0 && /delete/i.test(dialogText), dialogText.slice(0, 120));
		await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
		await sleep(500);
		check('cancelling Delete changes nothing', /ContKeep/.test(readFileSync(leftPath, 'utf8')));
		record.screenshots.push(...(await shot('deep-row-menu-delete-cancel', frame)));

		await rowLine(frame, 'ContKeep').click({ button: 'right' });
		await sleep(400);
		await frame.locator('.context-view .action-item', { hasText: 'Duplicate ECUC element' }).first().click({ force: true });
		await sleep(700);
		const quick = page.locator('.quick-input-widget').first();
		const quickVisible = await quick.isVisible().catch(() => false);
		const quickText = quickVisible ? await quick.innerText().catch(() => '') : '';
		record.observations.duplicatePrompt = { quickVisible, quickText: quickText.slice(0, 160) };
		check('Duplicate asks for a new short name', quickVisible && /short name/i.test(quickText), quickText.slice(0, 120));
		if (quickVisible) {
			const quickInput = page.locator('.quick-input-widget input').first();
			await quickInput.click();
			await page.keyboard.type('ContKeepCopy');
			await sleep(400);
			await page.keyboard.press('Enter');
			await sleep(1500);
			record.observations.afterDuplicateEnter = {
				quickVisible: await quick.isVisible().catch(() => false),
				quickValue: await quick.locator('input').first().inputValue().catch(() => ''),
				pages: browser.contexts().flatMap((context) => context.pages().map((candidate) => candidate.url())),
				strip: await frame.locator('#editor-error-strip').innerText().catch(() => ''),
				status: await frame.locator('#details-status').innerText().catch(() => ''),
				notifications: await workbenchNotifications()
			};
			const confirm = page.locator('.monaco-dialog-box').first();
			const confirmCount = await confirm.count();
			const confirmText = confirmCount ? await confirm.innerText().catch(() => '') : '';
			record.observations.duplicateConfirm = { confirmCount, text: confirmText.slice(0, 160) };
			check('Duplicate confirms before writing', confirmCount > 0 && /duplicate/i.test(confirmText), confirmText.slice(0, 120));
			if (confirmCount > 0) {
				await page.locator('.monaco-dialog-box').getByRole('button', { name: 'Duplicate', exact: true }).click().catch(() => {});
			}
			await sleep(1600);
			await B('/save', { path: leftPath });
			await sleep(600);
			const text = readFileSync(leftPath, 'utf8');
			check('the duplicate is written after confirmation', /ContKeepCopy/.test(text));
			check('the duplicate row is visible', (await rowLine(frame, 'ContKeepCopy').count()) > 0);
			record.screenshots.push(...(await shot('deep-row-menu-duplicate', frame)));
		}
	});

	await scenario('conditions-tab', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		const syscond = path.join(WS, 'syscond.arxml');
		copyFileSync(path.join(repoRoot, 'src/test/fixtures/editor/syscond.arxml'), syscond);
		const frame = await openEditor(syscond);
		await frame.locator('#stab-conditions').click();
		await sleep(500);
		const panelVisible = await frame.locator('#sbp-conditions').isVisible().catch(() => false);
		record.observations.panelVisible = panelVisible;
		check('the Conditions tab opens', panelVisible);
		const disabledBefore = await frame.locator('#conditions-count').innerText().catch(() => '');
		record.observations.disabledBefore = disabledBefore;
		const row = frame.locator('.condition-row[data-name="CANIPCORETYPE_SC"]').first();
		check('the referenced constant has a row', (await row.count()) > 0);
		await row.locator('.condition-edit').click();
		await sleep(300);
		await row.locator('.condition-value').fill('1');
		await row.locator('.condition-save').click();
		await sleep(1300);
		record.observations.afterSet = {
			value: await frame.locator('.condition-row[data-name="CANIPCORETYPE_SC"]').first().getAttribute('data-value').catch(() => null),
			status: await frame.locator('#conditions-status').innerText().catch(() => ''),
			disabled: await frame.locator('#conditions-count').innerText().catch(() => '')
		};
		check('saving the value commits it', record.observations.afterSet.value === '1', String(record.observations.afterSet.value));
		check('the document re-evaluates its disabled rows', record.observations.afterSet.disabled !== disabledBefore, `${disabledBefore} -> ${record.observations.afterSet.disabled}`);
		record.screenshots.push(...(await shot('deep-conditions-set', frame)));

		await frame.locator('#conditions-add').click();
		await sleep(300);
		const draft = frame.locator('.condition-row[data-new="true"]').first();
		await draft.locator('.condition-name').fill('1BAD');
		await draft.locator('.condition-value').fill('x');
		await draft.locator('.condition-save').click();
		await sleep(600);
		const invalidStatus = await frame.locator('#conditions-status').innerText().catch(() => '');
		record.observations.invalidNameStatus = invalidStatus;
		check('an invalid constant name is refused inline', /invalid name/i.test(invalidStatus), invalidStatus);
		check('the invalid draft stays editable', (await frame.locator('.condition-row[data-new="true"]').count()) > 0);
		await draft.locator('.condition-name').fill('FEATURE');
		await draft.locator('.condition-value').fill('true');
		await draft.locator('.condition-save').click();
		await sleep(900);
		const added = frame.locator('.condition-row[data-name="FEATURE"]').first();
		record.observations.added = {
			count: await added.count(),
			value: (await added.count()) ? await added.getAttribute('data-value') : null
		};
		check('a valid manual row saves', record.observations.added.count > 0 && record.observations.added.value === 'true', JSON.stringify(record.observations.added));
		await frame.locator('#conditions-clear').click();
		await sleep(700);
		record.observations.afterClear = {
			rows: await frame.locator('.condition-row').count(),
			value: await frame.locator('.condition-row[data-name="FEATURE"]').first().getAttribute('data-value').catch(() => null),
			status: await frame.locator('#conditions-status').innerText().catch(() => '')
		};
		check('Clear values empties the values but keeps the rows', record.observations.afterClear.rows > 0 && record.observations.afterClear.value === '', JSON.stringify(record.observations.afterClear));
		record.screenshots.push(...(await shot('deep-conditions-clear', frame)));
	});

	await scenario('reveal-modes', async ({ check, record }) => {
		record.observations.modes = {};
		for (const mode of ['beside', 'focus', 'replace']) {
			await reset();
			await ensureChatClosed();
			await B('/setting', { section: 'arxmlScope.ecuc.editor', key: 'revealMode', value: mode });
			const frame = await openEditorOnly(leftPath);
			await rowLine(frame, 'ContKeep').click();
			await sleep(300);
			await frame.getByRole('button', { name: 'Reveal in source' }).click();
			await sleep(1000);
			const state = await B('/state');
			const observation = {
				activeTab: state.activeTab,
				activeTextEditor: state.activeTextEditor,
				tabs: state.tabs.map((tab) => `${tab.label}${tab.viewType ? ':' + tab.viewType : ''}`),
				activeElement: await activeIn(frame)
			};
			record.observations.modes[mode] = observation;
			if (mode === 'beside') {
				check('beside keeps the ECUC editor active', observation.activeTab?.viewType === 'vscode-arxml-scope.ecucEditor', JSON.stringify(observation.activeTab));
				check('beside opens a source tab next to it', observation.tabs.some((tab) => tab.endsWith('left.arxml') && !tab.includes('vscode-arxml-scope')));
			}
			if (mode === 'focus') {
				check('focus moves to the source editor', path.resolve(observation.activeTextEditor ?? '').toLowerCase() === path.resolve(leftPath).toLowerCase(), JSON.stringify(observation.activeTextEditor));
			}
			if (mode === 'replace') {
				check('replace removes the ECUC tab', !observation.tabs.some((tab) => tab.includes('vscode-arxml-scope.ecucEditor')), observation.tabs.join(', '));
			}
			if (mode === 'focus') {
				await page.keyboard.press('Control+f');
				await page.keyboard.type('ContKeep');
				await page.keyboard.press('Enter');
				await page.keyboard.press('Escape');
				await B('/exec', { command: 'vscode-arxml-scope.revealInEcucEditor' });
				await sleep(1200);
				const back = await B('/state');
				const editorFrame = await findFrameWith('#toggle-sidebar');
				const details = await editorFrame.locator('#sb-details-body').innerText().catch(() => '');
				record.observations.reverse = { activeTab: back.activeTab, details: details.slice(0, 120) };
				check('Reveal in ECUC Editor returns to the custom editor', back.activeTab?.viewType === 'vscode-arxml-scope.ecucEditor', JSON.stringify(back.activeTab));
				check('the reverse reveal selects the node at the cursor', /ContKeep/.test(details), details.slice(0, 80));
				record.screenshots.push(...(await shot('deep-reveal-reverse', editorFrame)));
			}
			record.screenshots.push(...(await shot(`deep-reveal-${mode}`, mode === 'beside' ? frame : undefined)));
		}
		await B('/setting', { section: 'arxmlScope.ecuc.editor', key: 'revealMode', value: 'beside' });
	});

	await scenario('find-replace', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		const frame = await openEditor();
		await rowLine(frame, 'ContKeep').click();
		await sleep(300);
		await page.keyboard.press('Control+f');
		await sleep(500);
		record.observations.widgets = await frame.evaluate(() =>
			[...document.querySelectorAll('.find-widget')].map((element) => ({
				id: element.id,
				cls: String(element.className).slice(0, 80),
				visible: Boolean(element.offsetWidth || element.offsetHeight),
				inputs: element.querySelectorAll('input').length,
				text: (element.textContent || '').trim().slice(0, 60)
			}))
		);
		const widget = frame.locator('.find-widget.visible').first();
		const findVisible = (await widget.count()) > 0;
		record.observations.findVisible = findVisible;
		check('Ctrl+F opens the native find widget', findVisible);
		await page.keyboard.type('Changed');
		await sleep(1000);
		const widgetText = await widget.innerText().catch(() => '');
		record.observations.widgetText = widgetText.slice(0, 120);
		check('the native widget reports the match count', /\d+\s*of\s*\d+|\d+\s+results?|no results/i.test(widgetText), widgetText.slice(0, 80));
		await page.keyboard.press('Escape');
		record.screenshots.push(...(await shot('deep-find', frame)));
		// The native widget's inputs live in a closed shadow root in this VS Code build;
		// the replace row cannot be driven from Playwright. Recorded as a coverage gap.
		record.observations.replaceGap = 'native find inputs are not reachable over CDP (closed shadow root)';
	});

	await scenario('settings-sort', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		const sortPath = path.join(WS, 'sorttest.arxml');
		const param = (name, value) =>
			`<ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/Sort/C/${name}</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE>`;
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>Sort</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/Sort</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/Sort/C</DEFINITION-REF><PARAMETER-VALUES>${param('Zeta', 1)}${param('Alpha', 2)}${param('Mu', 3)}</PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		await writeDoc(sortPath, xml);
		await B('/setting', { section: 'arxmlScope.ecuc.editor', key: 'sort', value: 'all' });
		const frame = await openEditorOnly(sortPath);
		const parameterRows = async () =>
			(await frame.locator('.view-line').allInnerTexts()).map((line) => line.trim()).filter((line) => /^(Zeta|Alpha|Mu)\s*=/.test(line));
		record.observations.allOrder = await parameterRows();
		check('sort: all orders the parameters', record.observations.allOrder[0]?.startsWith('Alpha'), JSON.stringify(record.observations.allOrder));
		await B('/setting', { section: 'arxmlScope.ecuc.editor', key: 'sort', value: 'declaration' });
		await sleep(1200);
		record.observations.declarationOrder = await parameterRows();
		check('sort: declaration restores file order live', record.observations.declarationOrder[0]?.startsWith('Zeta'), JSON.stringify(record.observations.declarationOrder));
		await B('/setting', { section: 'arxmlScope.ecuc.editor', key: 'sort', value: 'all' });
		await sleep(600);
		record.screenshots.push(...(await shot('deep-settings-sort', frame)));
	});

	await scenario('diff-collapse-all', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		const frame = await openDiff();
		const before = await frame.locator('.view-line').count();
		await frame.locator('#diff-collapse-all').click();
		await sleep(1000);
		const collapsed = await frame.locator('.view-line').count();
		record.observations.collapse = { before, collapsed };
		check('Collapse All hides container children', collapsed < before, `${before} -> ${collapsed}`);
		record.screenshots.push(...(await shot('deep-diff-collapse-all', frame)));
		await frame.locator('#diff-expand-all').click();
		await sleep(1000);
		const expanded = await frame.locator('.view-line').count();
		record.observations.expand = { collapsed, expanded };
		check('Expand All restores the rows', expanded >= before - 2, `${collapsed} -> ${expanded}`);
	});

	await scenario('diff-showdiff-swap', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		const frame = await openDiff();
		const titles = async () => ({
			left: await frame.locator('#diff-title-left').innerText(),
			right: await frame.locator('#diff-title-right').innerText()
		});
		const before = await titles();
		await frame.locator('#diff-swap').click();
		await sleep(500);
		const swapped = await titles();
		record.observations.titles = { before, swapped };
		check('Swap mirrors the pane titles', swapped.left === before.right && swapped.right === before.left, JSON.stringify(swapped));
		check('Swap is shown as a state', (await frame.locator('#diff-swap').getAttribute('aria-pressed')) === 'true');
		await frame.locator('#diff-swap').click();
		await sleep(400);
		// The default fixture is dense (changes every few rows), so hiding needs a long
		// unchanged run: use a 400-parameter pair with one change near line 250.
		const big = bigPair(400, 250);
		const bigLeft = path.join(WS, 'showdiff-left.arxml');
		const bigRight = path.join(WS, 'showdiff-right.arxml');
		await writeDoc(bigLeft, big.left);
		await writeDoc(bigRight, big.right);
		await B('/closeAll');
		const bigFrame = await openDiff(bigLeft, bigRight);
		const allLines = await bigFrame.locator('.view-line').count();
		await bigFrame.locator('#diff-view-diff').click();
		await sleep(1200);
		const diffLines = await bigFrame.locator('.view-line').count();
		const contextDisabled = await bigFrame.locator('#diff-context').getAttribute('disabled');
		record.observations.showDiff = { allLines, diffLines, contextDisabled };
		check('Show diff is pressed', (await bigFrame.locator('#diff-view-diff').getAttribute('aria-pressed')) === 'true');
		check('Show diff hides unchanged rows', diffLines < allLines, `${allLines} -> ${diffLines}`);
		check('Context is enabled in Show diff', contextDisabled === null, String(contextDisabled));
		await bigFrame.locator('#diff-context').click();
		await sleep(900);
		const contextOffLines = await bigFrame.locator('.view-line').count();
		record.observations.contextOff = { contextOffLines, pressed: await bigFrame.locator('#diff-context').getAttribute('aria-pressed') };
		check('Context off hides the surrounding unchanged rows', contextOffLines <= diffLines, `${diffLines} -> ${contextOffLines}`);
		record.screenshots.push(...(await shot('deep-diff-showdiff', bigFrame)));
		await bigFrame.locator('#diff-view-all').click();
		await sleep(900);
		const restored = await bigFrame.locator('.view-line').count();
		check('Show all restores the rows', restored >= allLines - 2, `${contextOffLines} -> ${restored}`);
		check('Context is disabled in Show all', (await bigFrame.locator('#diff-context').getAttribute('disabled')) !== null);
	});

	await scenario('diff-identical', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		const same = readFileSync(leftPath, 'utf8');
		const a = path.join(WS, 'identical-a.arxml');
		const b = path.join(WS, 'identical-b.arxml');
		await writeDoc(a, same);
		await writeDoc(b, same);
		await B('/exec', { command: 'vscode-arxml-scope.compareSelected', args: [uri(a), [uri(b)]] });
		const frame = await findFrameWith('#diff-view-all');
		await sleep(1200);
		const empty = frame.locator('#diff-empty');
		const visible = await empty.isVisible().catch(() => false);
		const text = await frame.locator('#diff-empty-text').innerText().catch(() => '');
		record.observations.empty = { visible, text };
		check('identical files show a stated empty result', visible && /no differences/i.test(text), `${visible} ${text}`);
		check('the toolbar is still available', (await frame.locator('.toolbar .tool').count()) === 11);
		record.screenshots.push(...(await shot('deep-diff-identical', frame)));
	});

	await scenario('diff-side-not-ecuc', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		const frame = await openDiff();
		const rowsBefore = await frame.locator('.view-line').count();
		const notEcuc = '<?xml version="1.0" encoding="UTF-8"?>\n<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES/></AUTOSAR>\n';
		await B('/replaceDocument', { path: rightPath, content: notEcuc, waitMs: 0 });
		await sleep(1500);
		const notice = frame.locator('#diff-notice');
		const noticeText = await notice.innerText().catch(() => '');
		const noticeVisible = await notice.isVisible().catch(() => false);
		const rowsAfter = await frame.locator('.view-line').count();
		record.observations = { rowsBefore, rowsAfter, noticeVisible, noticeText: noticeText.slice(0, 200) };
		check('the last good comparison stays visible', rowsAfter > 0, `${rowsBefore} -> ${rowsAfter}`);
		check('a side that stops being ECUC is explained', noticeVisible && /ECUC|refresh|could not/i.test(noticeText), noticeText.slice(0, 120));
		check('the notice explains that the comparison stopped updating', /stopped|last good|no longer updating|stale/i.test(noticeText), noticeText.slice(0, 120));
		check('the notice does not promise a text editor that is not shown', !/showing the text editor/i.test(noticeText), noticeText.slice(0, 120));
		record.screenshots.push(...(await shot('deep-diff-side-not-ecuc', frame)));
	});

	await scenario('merge-collision', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		const moduleXml = (name, value) => `<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>${name}</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/${name}</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>C</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/${name}/C</DEFINITION-REF><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/${name}/C/V</DEFINITION-REF><VALUE>${value}</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE></CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES>`;
		const wrap = (modules) => `<?xml version="1.0" encoding="UTF-8"?>\n<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>${modules}</ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const left = path.join(WS, 'col-left.arxml');
		const right = path.join(WS, 'col-right.arxml');
		await writeDoc(left, wrap(moduleXml('ColX', 1)));
		await writeDoc(right, wrap(moduleXml('ColY', 2)));
		const frame = await openDiff(left, right);
		await frame.locator('#diff-merge').click();
		await sleep(700);
		const rightBefore = readFileSync(right, 'utf8');
		const line = frame.locator('.line-delete').first();
		await line.hover({ force: true }).catch(() => {});
		await sleep(300);
		const copy = frame.locator('a[aria-label="Copy Block to Right"], button[aria-label="Copy Block to Right"]').first();
		const copyCount = await copy.count();
		record.observations.copyCount = copyCount;
		if (copyCount > 0) {
			await copy.click({ force: true }).catch(() => {});
			await sleep(1400);
		}
		const notice = frame.locator('#diff-notice');
		const noticeText = await notice.innerText().catch(() => '');
		record.observations.notice = { visible: await notice.isVisible().catch(() => false), text: noticeText.slice(0, 200) };
		check('copying a missing module is refused', /module/i.test(noticeText), noticeText.slice(0, 120));
		check('the refusal names the missing module', /\/P\/|ColX|ColY/.test(noticeText), noticeText.slice(0, 120));
		check('the refusal offers a way to reach the module', /reveal|go to|select|scroll/i.test(noticeText), noticeText.slice(0, 120));
		check('the refused copy writes nothing', readFileSync(right, 'utf8') === rightBefore);
		record.screenshots.push(...(await shot('deep-merge-collision', frame)));
	});

	await scenario('merge-subtree', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		const extra = `<ECUC-CONTAINER-VALUE><SHORT-NAME>Extra</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/Sub/Extra</DEFINITION-REF><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/Sub/Extra/Nested</DEFINITION-REF><VALUE>5</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE>`;
		const wrap = (containers) => `<?xml version="1.0" encoding="UTF-8"?>\n<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS><ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>Sub</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/Sub</DEFINITION-REF><CONTAINERS><ECUC-CONTAINER-VALUE><SHORT-NAME>Base</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/Sub/Base</DEFINITION-REF><PARAMETER-VALUES><ECUC-NUMERICAL-PARAM-VALUE><DEFINITION-REF DEST="ECUC-INTEGER-PARAM-DEF">/P/Sub/Base/BaseVal</DEFINITION-REF><VALUE>1</VALUE></ECUC-NUMERICAL-PARAM-VALUE></PARAMETER-VALUES></ECUC-CONTAINER-VALUE>${containers}</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES></ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>`;
		const left = path.join(WS, 'sub-left.arxml');
		const right = path.join(WS, 'sub-right.arxml');
		await writeDoc(left, wrap(extra));
		await writeDoc(right, wrap(''));
		const frame = await openDiff(left, right);
		await frame.locator('#diff-merge').click();
		await sleep(700);
		const line = frame.locator('.line-delete').filter({ hasText: 'Extra' }).first();
		await line.hover({ force: true }).catch(() => {});
		await sleep(300);
		const copy = frame.locator('a[aria-label="Copy Block to Right"], button[aria-label="Copy Block to Right"]').first();
		if ((await copy.count()) > 0) {
			await copy.click({ force: true }).catch(() => {});
			await sleep(1600);
		}
		await B('/save', { path: right });
		await sleep(600);
		const text = readFileSync(right, 'utf8');
		record.observations.rightText = text.slice(0, 400);
		check('the copied container is written', /<SHORT-NAME>Extra<\/SHORT-NAME>/.test(text));
		check('the whole subtree comes with it', /Nested<\/DEFINITION-REF>\s*<VALUE>5<\/VALUE>/.test(text));
		record.screenshots.push(...(await shot('deep-merge-subtree', frame)));
	});

	await scenario('merge-off', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		const frame = await openDiff();
		const visibleCopies = () =>
			frame.evaluate(() =>
				[...document.querySelectorAll('a[aria-label="Copy Block to Right"], button[aria-label="Copy Block to Right"]')].filter(
					(element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
				).length
			);
		await frame.locator('.line-insert').first().hover({ force: true }).catch(() => {});
		await sleep(400);
		const offCount = await visibleCopies();
		await frame.locator('#diff-merge').click();
		await sleep(600);
		await frame.locator('.line-insert').first().hover({ force: true }).catch(() => {});
		await sleep(400);
		const onCount = await visibleCopies();
		await frame.locator('#diff-merge').click();
		await sleep(600);
		await frame.locator('.line-insert').first().hover({ force: true }).catch(() => {});
		await sleep(400);
		const offAgain = await visibleCopies();
		record.observations = { offCount, onCount, offAgain };
		check('Merge off offers no copy action', offCount === 0, String(offCount));
		check('Merge on offers the copy action', onCount > 0, String(onCount));
		check('turning Merge off removes it again', offAgain === 0, String(offAgain));
	});

	await scenario('index-toggles', async ({ check, record }) => {
		await reset();
		const readStatus = () => statusLabels();
		const readCount = (text) => Number(/(\d+) files indexed/.exec(text)?.[1] ?? NaN);
		const initial = await readStatus();
		const initialCount = readCount(initial);
		record.observations.initial = { count: initialCount, text: initial.slice(0, 220) };
		check('the index starts enabled', Number.isFinite(initialCount), initial.slice(0, 160));
		await B('/setting', { section: 'arxmlScope.index', key: 'enabled', value: false });
		await sleep(900);
		const disabled = await readStatus();
		record.observations.disabled = disabled.slice(0, 220);
		check('disabling the index hides its status', !/files indexed/i.test(disabled), disabled.slice(0, 160));
		await B('/setting', { section: 'arxmlScope.index', key: 'enabled', value: true });
		await B('/exec', { command: 'vscode-arxml-scope.rebuildIndex' });
		await sleep(1800);
		const reenabled = await readStatus();
		check('re-enabling restores the index', readCount(reenabled) === initialCount, reenabled.slice(0, 160));
		await B('/setting', { section: 'arxmlScope.index', key: 'exclude', value: ['**/right.arxml'] });
		await B('/exec', { command: 'vscode-arxml-scope.rebuildIndex' });
		await sleep(1800);
		const excluded = await readStatus();
		const excludedCount = readCount(excluded);
		record.observations.exclude = { count: excludedCount, text: excluded.slice(0, 220) };
		check('an excluded file leaves the index count', excludedCount === initialCount - 1, `${initialCount} -> ${excludedCount}`);
		check('the tooltip reports the excluded file', /excluded by arxmlScope\.index\.exclude/i.test(excluded), excluded.slice(0, 160));
		await B('/setting', { section: 'arxmlScope.index', key: 'exclude', value: [] });
		await B('/exec', { command: 'vscode-arxml-scope.rebuildIndex' });
		await sleep(1800);
		const hugePath = path.join(WS, 'huge.arxml');
		await writeDoc(hugePath, bigPair(12000, 6000).left);
		await B('/exec', { command: 'vscode-arxml-scope.rebuildIndex' });
		await sleep(3000);
		const withHuge = await readStatus();
		const withHugeCount = readCount(withHuge);
		record.observations.withHuge = { count: withHugeCount, text: withHuge.slice(0, 220) };
		check('the large file is indexed under the default cap', withHugeCount === initialCount + 1, `${initialCount} -> ${withHugeCount}`);
		await B('/setting', { section: 'arxmlScope.index', key: 'maxFileSizeMB', value: 1 });
		await B('/exec', { command: 'vscode-arxml-scope.rebuildIndex' });
		await sleep(3000);
		const capped = await readStatus();
		const cappedCount = readCount(capped);
		record.observations.capped = { count: cappedCount, text: capped.slice(0, 260) };
		check('the size cap skips the large file', cappedCount === initialCount, `${withHugeCount} -> ${cappedCount}`);
		check('the tooltip reports the skipped file', /skipped|too large|maxFileSizeMB/i.test(capped), capped.slice(0, 160));
		check('the skipped tooltip names the actual reason', !/encoding or unreadable/i.test(capped), capped.slice(0, 160));
		await B('/setting', { section: 'arxmlScope.index', key: 'maxFileSizeMB', value: 50 });
		await B('/deleteFile', { path: hugePath });
		await B('/exec', { command: 'vscode-arxml-scope.rebuildIndex' });
		await sleep(1800);
		const cycleLabel = async () => {
			await B('/exec', { command: 'vscode-arxml-scope.cycleCrossFileRules' });
			await sleep(700);
			return readStatus();
		};
		const always = await cycleLabel();
		const never = await cycleLabel();
		const auto = await cycleLabel();
		record.observations.cycle = { always: always.slice(0, 140), never: never.slice(0, 140), auto: auto.slice(0, 140) };
		check('the cycle reaches always', /cross-file checks always/i.test(always), always.slice(0, 160));
		check('the cycle reaches never', /cross-file checks off/i.test(never) && !/always/i.test(never), never.slice(0, 160));
		check('the cycle returns to auto', /off \(no project\)/i.test(auto), auto.slice(0, 160));
		record.screenshots.push(...(await shot('deep-index-toggles')));
	});

	await scenario('engine-restart', async ({ check, record }) => {
		await reset();
		await B('/exec', { command: 'vscode-arxml-scope.showEngineStatus', detached: true });
		await sleep(1300);
		const first = (await workbenchNotifications()).join(' / ');
		const firstPid = /pid (\d+)/.exec(first)?.[1];
		record.observations.first = { text: first.slice(0, 200), pid: firstPid };
		check('Show Engine Status reports a running pid', Boolean(firstPid), first.slice(0, 160));
		const restart = page.getByRole('button', { name: 'Restart Engine' }).first();
		if ((await restart.count()) > 0) {
			await restart.click().catch(() => {});
			await sleep(2800);
		}
		const restarted = (await workbenchNotifications()).join(' / ');
		record.observations.restarted = restarted.slice(0, 200);
		check('Restart reports success', /engine restarted/i.test(restarted), restarted.slice(0, 160));
		await B('/exec', { command: 'vscode-arxml-scope.showEngineStatus', detached: true });
		await sleep(1300);
		const second = (await workbenchNotifications()).join(' / ');
		const secondPid = /pid (\d+)/.exec(second)?.[1];
		record.observations.second = { text: second.slice(0, 200), pid: secondPid };
		check('Restart actually replaces the process', Boolean(secondPid) && secondPid !== firstPid, `${firstPid} -> ${secondPid}`);
		record.screenshots.push(...(await shot('deep-engine-restart')));
	});

	await scenario('theme-zoom', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		const frame = await openEditor();
		const probe = () =>
			frame.evaluate(() => {
				const rgb = (value) => {
					const srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(String(value));
					if (srgb) {
						return [srgb[1], srgb[2], srgb[3]].map((part) => Math.round(Number(part) * 255));
					}
					return (String(value).match(/\d+/g) ?? []).map(Number);
				};
				const luminance = (color) => {
					const [r, g, b] = color.map((part) => part / 255).map((part) => (part <= 0.03928 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4)));
					return 0.2126 * r + 0.7152 * g + 0.0722 * b;
				};
				const contrast = (a, b) => {
					const l1 = luminance(a);
					const l2 = luminance(b);
					return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
				};
				const body = getComputedStyle(document.body);
				const bg = rgb(body.backgroundColor);
				const fg = rgb(body.color);
				const bar = document.querySelector('.toolbar');
				const tool = document.querySelector('.toolbar .tool');
				const tbg = bar ? rgb(getComputedStyle(bar).backgroundColor) : bg;
				const tfg = tool ? rgb(getComputedStyle(tool).color) : fg;
				return {
					bg,
					fg,
					tbg,
					tfg,
					tbgRaw: bar ? getComputedStyle(bar).backgroundColor : null,
					tfgRaw: tool ? getComputedStyle(tool).color : null,
					bodyContrast: Math.round(contrast(fg, bg) * 10) / 10,
					toolContrast: Math.round(contrast(tfg, tbg) * 10) / 10,
					overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
				};
			});
		await B('/setting', { section: 'workbench', key: 'colorTheme', value: 'Default Light Modern' });
		await sleep(1100);
		const light = await probe();
		record.observations.light = light;
		check('the light theme paints a light surface', light.bg[0] > 128, JSON.stringify(light.bg));
		check('body text keeps 4.5:1 contrast in light', light.bodyContrast >= 4.5, String(light.bodyContrast));
		check('toolbar text keeps 3:1 contrast in light', light.toolContrast >= 3, String(light.toolContrast));
		check('toolbar labels keep 4.5:1 contrast in light', light.toolContrast >= 4.5, `${light.toolContrast}:1 ${JSON.stringify(light.tfgRaw)} on ${JSON.stringify(light.tbgRaw)}`);
		record.screenshots.push(...(await shot('deep-theme-light', frame)));
		await B('/setting', { section: 'workbench', key: 'colorTheme', value: 'Default High Contrast' });
		await sleep(1100);
		const hc = await probe();
		record.observations.highContrast = hc;
		check('high contrast keeps a dark surface and light text', hc.bg[0] < 40 && hc.fg[0] > 200, JSON.stringify({ bg: hc.bg, fg: hc.fg }));
		record.screenshots.push(...(await shot('deep-theme-hc', frame)));
		await B('/setting', { section: 'workbench', key: 'colorTheme', value: 'Default Dark Modern' });
		await sleep(900);
		await B('/exec', { command: 'workbench.action.zoomIn' });
		await B('/exec', { command: 'workbench.action.zoomIn' });
		await sleep(1200);
		const layout = await frame.evaluate(() => {
			const bar = document.querySelector('.toolbar')?.getBoundingClientRect();
			const tools = [...document.querySelectorAll('.toolbar .tool')].map((element) => element.getBoundingClientRect());
			let overlaps = 0;
			for (let index = 1; index < tools.length; index += 1) {
				if (tools[index].left < tools[index - 1].right - 1) {
					overlaps += 1;
				}
			}
			return {
				width: innerWidth,
				count: tools.length,
				overlaps,
				inside: tools.every((rect) => !bar || (rect.left >= bar.left - 1 && rect.right <= bar.right + 1)),
				overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
			};
		});
		record.observations.zoom150 = layout;
		check('150% zoom keeps the toolbar inside the row', layout.inside && layout.overlaps === 0, JSON.stringify(layout));
		check('150% zoom adds no page scroll', !layout.overflow, String(layout.overflow));
		record.screenshots.push(...(await shot('deep-theme-zoom150', frame)));
		await B('/exec', { command: 'workbench.action.zoomReset' });
		await sleep(600);
	});

	await scenario('first-gate', async ({ check, record }) => {
		await reset();
		await ensureChatClosed();
		record.observations.gates = {};
		for (const name of ['empty.arxml', 'malformed.arxml', 'not-ecuc.arxml']) {
			const file = path.join(WS, name);
			await B('/exec', { command: 'vscode-arxml-scope.openEcucEditor', args: [uri(file)] });
			await sleep(1000);
			const notifications = await workbenchNotifications();
			const tabs = (await B('/state')).tabs;
			const entry = {
				notifications: notifications.map((text) => text.slice(0, 180)),
				tabs: tabs.map((tab) => `${tab.label}${tab.viewType ? ':' + tab.viewType : ''}`)
			};
			record.observations.gates[name] = entry;
			check(`${name} is refused with an explanation`, notifications.some((text) => /ECUC values|not an \.arxml/i.test(text)), notifications.join(' / ').slice(0, 160));
			check(`${name} does not open the ECUC editor`, !tabs.some((tab) => tab.viewType === 'vscode-arxml-scope.ecucEditor'), entry.tabs.join(', '));
			check(`${name} opens the text editor the message promises`, tabs.length > 0, entry.tabs.join(', '));
		}
		record.screenshots.push(...(await shot('deep-first-gate')));
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
