/**
 * The compare commands and the diff panel entry point.
 *
 * The panel is opened through the real command so the test covers registration,
 * selection pairing, the gate and the webview tab. The webview content is
 * asserted separately against `renderDiffHtml`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { indentationAt, planCopy } from '../../core/copy/planCopy';
import { scanEcucValues } from '../../core/ecuc/scanner';
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

/** The panel source, for the host-only copy decisions `vscode-test` cannot message. */
function panelSource(): string {
	return fs.readFileSync(path.join(repoRoot, 'src', 'host', 'diffPanel.ts'), 'utf8');
}

/** Every compare command is contributed by the manifest. */
function assertContributedCommands(manifest: Manifest): void {
	const commands = manifest.contributes?.commands ?? [];
	for (const command of [SELECT_AS_FIRST, COMPARE_TO_STAGED, COMPARE_SELECTED]) {
		assert.ok(commands.some((entry) => entry.command === command), `${command} is contributed`);
	}
}

/** The three commands carry exactly the documented `when` clauses. */
function assertActionMenuWhen(manifest: Manifest): void {
	assert.strictEqual(
		actionMenuWhen(manifest, SELECT_AS_FIRST),
		'resourceExtname == .arxml && !listMultiSelection && explorerViewletFocus'
	);
	assert.strictEqual(
		actionMenuWhen(manifest, COMPARE_TO_STAGED),
		'resourceExtname == .arxml && !listMultiSelection && explorerViewletFocus && arxmlScope.hasCompareSelection'
	);
	assert.strictEqual(
		actionMenuWhen(manifest, COMPARE_SELECTED),
		'resourceExtname == .arxml && listDoubleSelection && explorerViewletFocus'
	);
}

function actionMenuWhen(manifest: Manifest, command: string): string | undefined {
	const items = manifest.contributes?.menus?.['arxmlScope.actions'] ?? [];
	return items.find((item) => item.command === command)?.when;
}

/** No diff command is a flat editor/context entry. */
function assertNoFlatEditorCommands(manifest: Manifest): void {
	const flatEditor = (manifest.contributes?.menus?.['editor/context'] ?? []).filter(
		(item) => item.command !== undefined && [SELECT_AS_FIRST, COMPARE_TO_STAGED, COMPARE_SELECTED].includes(item.command)
	);
	assert.deepStrictEqual(flatEditor, [], 'no diff command is a flat editor/context entry');
}

function isDiffTab(tab: vscode.Tab): boolean {
	const input = tab.input;
	// The test host reports the workbench's internal type
	// (`mainThreadWebview-vscode-arxml-scope.diff`); the panel's own
	// viewType remains the suffix.
	return input instanceof vscode.TabInputWebview && input.viewType.endsWith(DiffPanel.viewType);
}

function diffTabs(): vscode.Tab[] {
	const tabs: vscode.Tab[] = [];
	for (const group of vscode.window.tabGroups.all) {
		for (const tab of group.tabs) {
			if (isDiffTab(tab)) {
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
		assertContributedCommands(manifest);
		const submenus = (manifest.contributes?.submenus ?? []).filter((entry) => entry.id === 'arxmlScope.actions');
		assert.strictEqual(submenus.length, 1, 'there is still exactly one ARXML Scope submenu');
		assertActionMenuWhen(manifest);
		assertNoFlatEditorCommands(manifest);
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

	test('the diff stays read-only outside merge mode', () => {
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
		const panelSource = fs.readFileSync(path.join(repoRoot, 'src', 'host', 'diffPanel.ts'), 'utf8');
		assert.ok(panelSource.includes("mode: 'beside'"), 'reveal forces beside so the diff tab survives');
		const read = (file: string): string =>
			fs.readFileSync(path.join(repoRoot, 'src', ...file.split('/')), 'utf8');
		const pageSources = [
			read('core/diff/diffModel.ts'),
			read('webview/diffViewer.ts'),
			read('webview/components/diffView/diffView.ts'),
		].join('\n');
		const mergePanel = read('host/diffPanel.ts');
		assert.ok(
			!/\bwriteFile(Sync)?\s*\(|\bappendFile(Sync)?\s*\(/.test(`${pageSources}\n${mergePanel}`),
			'the diff never writes a file'
		);
		assert.ok(
			!/\bnew vscode\.WorkspaceEdit\b|\bapplyEdit\s*\(/.test(pageSources),
			'the page never edits a document'
		);
		// Merge mode is the only write path: one guard, one WorkspaceEdit.
		assert.ok(mergePanel.includes('if (!mergeMode)'), 'a copy is refused outside merge mode');
		assert.match(mergePanel, /new vscode\.WorkspaceEdit\(\)/, 'a copy applies one edit');
	});

	test('X-05 AC10/R19: opening the diff leaves both files byte-identical', async () => {
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

	test('MERGE-07 copying into a missing module is refused with a message before any edit', () => {
		// The refusal is a closure inside DiffPanel.open and needs a webview `copy`
		// message, which vscode-test cannot deliver. Pin the decision and its order:
		// the missing-module branch returns before the synthesized chain is applied.
		const panel = panelSource();
		assert.match(
			panel,
			/if \(hasTargetCell\(parent, sourceSide\)\) \{\s*return \{ ancestors, anchorParent: index \};/,
			'the chain stops at the nearest ancestor the target has'
		);
		assert.match(
			panel,
			/if \(chain === undefined\) \{\s*await postError\('the module is missing on the target side; copy it first'\);\s*return true;\s*\}/,
			'the refusal carries the documented message and returns'
		);
		const refusal = panel.indexOf('the module is missing on the target side; copy it first');
		const mutation = panel.indexOf('applyPlan(otherDoc, chainInsertion', refusal);
		assert.ok(mutation > refusal, 'a refused module copy reaches no applyPlan');
	});

	test('MERGE-08 a module row copy is allowed without a collision and refused with one', () => {
		const module = (shortName: string): string =>
			`        <ECUC-MODULE-CONFIGURATION-VALUES>
          <SHORT-NAME>${shortName}</SHORT-NAME>
          <DEFINITION-REF DEST="ECUC-MODULE-DEF">/Pkg/${shortName}</DEFINITION-REF>
          <CONTAINERS/>
        </ECUC-MODULE-CONFIGURATION-VALUES>`;
		const shell = (elements: string): string =>
			`<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR>
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Pkg</SHORT-NAME>
      <ELEMENTS>
${elements}
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>
`;
		const sourceText = shell(module('Mod'));
		const targetText = shell(module('Other'));
		const source = scanEcucValues(sourceText).modules.find((candidate) => candidate.shortName === 'Mod');
		const anchor = scanEcucValues(targetText).modules.find((candidate) => candidate.shortName === 'Other');
		assert.ok(source, 'the source has the module row');
		assert.ok(anchor, 'the target has its own module row');
		const planned = planCopy({
			targetText,
			sourceText,
			source: source!.range,
			anchorAfter: anchor!.range,
			targetIndent: indentationAt(targetText, anchor!.range.start)
		});
		assert.ok(planned.ok, 'a module row with no target name collision is insertable');
		const result = targetText.slice(0, planned.span.start) + planned.span.text + targetText.slice(planned.span.end);
		assert.deepStrictEqual(
			scanEcucValues(result).modules.map((candidate) => candidate.shortName),
			['Other', 'Mod'],
			'the module is inserted next to its target sibling'
		);

		// The collision refusal is host-only; pin the exact predicate and its ordering.
		const panel = panelSource();
		assert.match(panel, /if \(row\.kind !== 'module'\) \{\s*return false;\s*\}/, 'only a module row can collide');
		assert.match(
			panel,
			/candidate\.kind === 'module' &&\s*cellOn\(candidate, targetSide\)\?\.shortName === name/,
			'the collision compares the short name on the target side'
		);
		assert.match(
			panel,
			/if \(moduleCollision\(side, located\.rowIndex\)\) \{\s*await postError\('that module already exists on the target side'\);\s*return;\s*\}/,
			'the collision is refused with the documented message'
		);
		const collision = panel.indexOf('moduleCollision(side, located.rowIndex)');
		const place = panel.indexOf('await placeCopy(', collision);
		assert.ok(place > collision, 'the collision check runs before the copy is planned');
	});

	test('MERGE-13 stale bytes offer Reload/Cancel and only Reload mutates anything', () => {
		// The modal runs from the panel's `copy` message handler; vscode-test has no
		// webview message channel to it. Pin the wording, the two answers and the
		// single mutating branch: Cancel has no branch at all.
		const panel = panelSource();
		assert.match(
			panel,
			/showWarningMessage\(\s*'The comparison changed\. Reload it\?',\s*\{ modal: true \},\s*'Reload',\s*'Cancel'\s*\)/,
			'the modal offers Reload and Cancel'
		);
		assert.match(
			panel,
			/if \(answer === 'Reload'\) \{\s*await refreshNow\(\);\s*\}/,
			'only Reload rebuilds the comparison'
		);
		assert.ok(!panel.includes("answer === 'Cancel'"), 'Cancel has no branch, so it changes nothing');
		assert.match(
			panel,
			/if \(snapshotIsStale\(side, clickedDoc, otherDoc\)\) \{\s*await askReload\(\);\s*return;\s*\}/,
			'a stale snapshot is checked before the copy is planned'
		);
		assert.match(
			panel,
			/clickedPrepared\.version !== clickedDoc\.version \|\| otherPrepared\.version !== otherDoc\.version/,
			'either compared document being newer makes the snapshot stale'
		);
	});
});
