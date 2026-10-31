/**
 * The compare commands and the diff panel entry point (task design §4.2;
 * prd AC1, AC11, AC13, AC15).
 *
 * The panel is opened through the real command so the test covers registration,
 * selection pairing, the gate and the webview tab. The webview content is
 * asserted separately against `renderDiffHtml`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { CompareSelectionStore } from '../../host/compareSelection';
import { DiffPanel } from '../../host/diffPanel';
import { fixtureUri, repoRoot, sleep } from './testUtils';

const SELECT_AS_FIRST = 'vscode-arxml-scope.selectAsFirst';
const COMPARE_TO_STAGED = 'vscode-arxml-scope.compareToStaged';
const COMPARE_SELECTED = 'vscode-arxml-scope.compareSelected';

interface Manifest {
	contributes?: {
		submenus?: Array<{ id: string; label: string }>;
		commands?: Array<{ command: string; title: string }>;
		menus?: Record<string, Array<{ command?: string; submenu?: string; when?: string }>>;
	};
}

function readManifest(): Manifest {
	return JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as Manifest;
}

function diffTabs(): vscode.Tab[] {
	const tabs: vscode.Tab[] = [];
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			const input = tab.input;
			// The test host reports the workbench's internal type
			// (`mainThreadWebview-vscode-arxml-scope.diff`); the panel's own
			// viewType remains the suffix.
			if (input instanceof vscode.TabInputWebview && input.viewType.endsWith(DiffPanel.viewType)) {
				tabs.push(tab);
			}
		}
	}
	return tabs;
}

async function closeDiffTabs(): Promise<void> {
	const tabs = diffTabs();
	if (tabs.length > 0) {
		await vscode.window.tabGroups.close(tabs, true);
	}
}

async function waitFor(what: string, predicate: () => boolean, timeoutMs = 5000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) {
			return;
		}
		await sleep(25);
	}
	assert.fail(`timed out waiting for ${what}`);
}

async function ensureActivated(): Promise<void> {
	const extension = vscode.extensions.getExtension('deviousprophet.vscode-arxml-scope');
	assert.ok(extension, 'the extension is installed in the test host');
	await extension!.activate();
}

suite('compare commands and diff panel (AC1, AC11, AC13)', function () {
	this.timeout(15000);

	suiteSetup(async () => {
		await ensureActivated();
	});

	teardown(async () => {
		await closeDiffTabs();
	});

	test('AC13: the three compare commands are registered', async () => {
		await ensureActivated();
		const commands = await vscode.commands.getCommands(true);
		for (const command of [SELECT_AS_FIRST, COMPARE_TO_STAGED, COMPARE_SELECTED]) {
			assert.ok(commands.includes(command), `${command} is registered`);
		}
	});

	test('AC13: the manifest adds the commands to the existing ARXML Scope submenu only', () => {
		const manifest = readManifest();
		const commands = manifest.contributes?.commands ?? [];
		for (const command of [SELECT_AS_FIRST, COMPARE_TO_STAGED, COMPARE_SELECTED]) {
			assert.ok(commands.some((entry) => entry.command === command), `${command} is contributed`);
		}
		const submenus = (manifest.contributes?.submenus ?? []).filter((entry) => entry.id === 'arxmlScope.actions');
		assert.strictEqual(submenus.length, 1, 'there is still exactly one ARXML Scope submenu');

		const items = manifest.contributes?.menus?.['arxmlScope.actions'] ?? [];
		const whenOf = (command: string): string | undefined => items.find((item) => item.command === command)?.when;
		assert.strictEqual(whenOf(SELECT_AS_FIRST), 'resourceExtname == .arxml && !listMultiSelection && explorerViewletFocus');
		assert.strictEqual(
			whenOf(COMPARE_TO_STAGED),
			'resourceExtname == .arxml && !listMultiSelection && explorerViewletFocus && arxmlScope.hasCompareSelection'
		);
		assert.strictEqual(
			whenOf(COMPARE_SELECTED),
			'resourceExtname == .arxml && listDoubleSelection && explorerViewletFocus'
		);

		const flatEditor = (manifest.contributes?.menus?.['editor/context'] ?? []).filter(
			(item) => item.command !== undefined && [SELECT_AS_FIRST, COMPARE_TO_STAGED, COMPARE_SELECTED].includes(item.command)
		);
		assert.deepStrictEqual(flatEditor, [], 'no diff command is a flat editor/context entry');
	});

	test('the session-only selection store keeps a URI and clears it', () => {
		const store = new CompareSelectionStore();
		const uri = fixtureUri('diff/left.arxml');
		assert.strictEqual(store.get(), null);
		store.set(uri);
		assert.strictEqual(store.get()?.toString(), uri.toString());
		store.clear();
		assert.strictEqual(store.get(), null);
	});

	test('AC11: compareToStaged without a first file warns and opens no panel', async () => {
		await closeDiffTabs();
		await vscode.commands.executeCommand(COMPARE_TO_STAGED, fixtureUri('diff/right.arxml'));
		await sleep(250);
		assert.strictEqual(diffTabs().length, 0, 'no diff panel is opened without a stash');
	});

	test('AC1: selectAsFirst then compareToStaged opens a vscode-arxml-scope.diff webview tab', async () => {
		await closeDiffTabs();
		const left = fixtureUri('diff/left.arxml');
		const right = fixtureUri('diff/right.arxml');
		await vscode.window.showTextDocument(left, { preview: false });
		await vscode.commands.executeCommand(SELECT_AS_FIRST, left);
		await vscode.commands.executeCommand(COMPARE_TO_STAGED, right);
		await waitFor('the diff tab', () => diffTabs().length === 1);
		const tab = diffTabs()[0];
		assert.ok(tab.input instanceof vscode.TabInputWebview);
		assert.ok((tab.input as vscode.TabInputWebview).viewType.endsWith(DiffPanel.viewType));
		assert.ok(tab.label.includes('left.arxml') && tab.label.includes('right.arxml'), tab.label);
	});

	test('AC1: compareSelected treats the clicked file as left and the other selection as right', async () => {
		await closeDiffTabs();
		const left = fixtureUri('diff/left.arxml');
		const right = fixtureUri('diff/right.arxml');
		await vscode.window.showTextDocument(left, { preview: false });
		await vscode.commands.executeCommand(COMPARE_SELECTED, left, [right, left]);
		await waitFor('the diff tab', () => diffTabs().length === 1);
		const tab = diffTabs()[0];
		assert.ok((tab.input as vscode.TabInputWebview).viewType.endsWith(DiffPanel.viewType));
		assert.ok(tab.label.startsWith('left.arxml'), tab.label);
	});

	test('the diff modules stay pure and the panel keeps no write path', () => {
		// Source-level guards for the task's hard constraints. The behavioural
		// reveal/refresh checks live in the Extension Development Host.
		for (const [folder, name] of [
			['core/diff', 'diffModel.ts'],
			['webview', 'diffViewer.ts'],
		] as const) {
			const source = fs.readFileSync(path.join(repoRoot, 'src', ...folder.split('/'), name), 'utf8');
			assert.ok(!/from 'vscode'/.test(source), `${name} has no vscode import`);
		}
		const rowView = fs.readFileSync(path.join(repoRoot, 'src', 'webview', 'render', 'rowView.ts'), 'utf8');
		assert.ok(!/from 'vscode'/.test(rowView), 'rowView has no vscode import');
		const panel = fs.readFileSync(path.join(repoRoot, 'src', 'host', 'diffPanel.ts'), 'utf8');
		assert.ok(panel.includes("mode: 'beside'"), 'reveal forces beside so the diff tab survives');
		const diffSources = [
			path.join(repoRoot, 'src', 'core', 'diff', 'diffModel.ts'),
			path.join(repoRoot, 'src', 'webview', 'diffViewer.ts'),
			path.join(repoRoot, 'src', 'webview', 'components', 'diffView', 'diffView.ts'),
			path.join(repoRoot, 'src', 'host', 'diffPanel.ts'),
		]
			.map((file) => fs.readFileSync(file, 'utf8'))
			.join('\n');
		assert.ok(
			!/\bwriteFile(Sync)?\s*\(|\bappendFile(Sync)?\s*\(|\bnew vscode\.WorkspaceEdit\b|\bapplyEdit\s*\(/.test(
				diffSources
			),
			'the diff never writes'
		);
	});

	test('AC10/R19: opening the diff leaves both files byte-identical', async () => {
		await closeDiffTabs();
		const left = fixtureUri('diff/left.arxml');
		const right = fixtureUri('diff/right.arxml');
		const before = [left, right].map((uri) => fs.readFileSync(uri.fsPath));
		await vscode.commands.executeCommand(COMPARE_SELECTED, left, [left, right]);
		await waitFor('the diff tab', () => diffTabs().length === 1);
		await sleep(250);
		const after = [left, right].map((uri) => fs.readFileSync(uri.fsPath));
		assert.ok(before[0].equals(after[0]), `${left.fsPath} is unchanged`);
		assert.ok(before[1].equals(after[1]), `${right.fsPath} is unchanged`);
	});

	test('AC11: a non-ECUC file is refused with no panel', async () => {
		await closeDiffTabs();
		const refused = fixtureUri('not-ecuc.arxml');
		const valid = fixtureUri('diff/left.arxml');
		await vscode.commands.executeCommand(COMPARE_SELECTED, refused, [refused, valid]);
		await sleep(300);
		assert.strictEqual(diffTabs().length, 0, 'no panel is created for a refused side');
	});

	test('AC11: a non-.arxml file is refused with no panel', async () => {
		await closeDiffTabs();
		const notArxml = vscode.Uri.file(path.join(repoRoot, 'README.md'));
		const valid = fixtureUri('diff/left.arxml');
		await vscode.commands.executeCommand(COMPARE_SELECTED, notArxml, [notArxml, valid]);
		await sleep(300);
		assert.strictEqual(diffTabs().length, 0, 'a non-arxml path never opens the panel');
	});
});
