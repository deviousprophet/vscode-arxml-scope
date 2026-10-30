/**
 * AC1–AC5 — the ARXML Scope submenu is contributed once, holds both editor
 * actions, and keeps "Reveal in ECUC Editor" out of the Explorer and out of the
 * extension's own custom editor.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { repoRoot } from './editorTestUtils';

interface MenuItem {
	command?: string;
	submenu?: string;
	when?: string;
	group?: string;
}

interface Manifest {
	contributes?: {
		submenus?: Array<{ id: string; label: string }>;
		menus?: Record<string, MenuItem[]>;
	};
}

const SUBMENU_ID = 'arxmlScope.actions';
const SUBMENU_LABEL = 'ARXML Scope';
const OPEN_COMMAND = 'vscode-arxml-scope.openEcucEditor';
const REVEAL_COMMAND = 'vscode-arxml-scope.revealInEcucEditor';
const VIEW_TYPE = 'vscode-arxml-scope.ecucEditor';

function readManifest(): Manifest {
	return JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as Manifest;
}

function itemsOf(manifest: Manifest, menuId: string): MenuItem[] {
	return manifest.contributes?.menus?.[menuId] ?? [];
}

suite('editor context menus (AC1–AC5)', () => {
	test('AC1: exactly one ARXML Scope submenu is contributed', () => {
		const submenus = readManifest().contributes?.submenus ?? [];
		assert.deepStrictEqual(submenus.filter((entry) => entry.label === SUBMENU_LABEL), [
			{ id: SUBMENU_ID, label: SUBMENU_LABEL },
		]);
	});

	test('AC2: the submenu holds both editor commands', () => {
		const items = itemsOf(readManifest(), SUBMENU_ID);
		const open = items.find((item) => item.command === OPEN_COMMAND);
		assert.ok(open, 'openEcucEditor is in the submenu');
		assert.strictEqual(open!.when, 'resourceExtname == .arxml', 'open is limited to .arxml in both contexts');
		assert.ok(
			items.some((item) => item.command === REVEAL_COMMAND),
			'revealInEcucEditor is in the submenu'
		);
	});

	test('AC3: editor/context contributes the submenu, not the flat commands', () => {
		const items = itemsOf(readManifest(), 'editor/context');
		const submenu = items.find((item) => item.submenu === SUBMENU_ID);
		assert.ok(submenu, 'editor/context has the ARXML Scope submenu');
		assert.strictEqual(
			submenu!.when,
			`resourceExtname == .arxml && activeCustomEditorId != '${VIEW_TYPE}'`,
			'the submenu is limited to .arxml text editors'
		);
		assert.deepStrictEqual(
			items.filter((item) => item.command === OPEN_COMMAND),
			[],
			'no flat open entry'
		);
		assert.deepStrictEqual(
			items.filter((item) => item.command === REVEAL_COMMAND),
			[],
			'no flat reveal entry'
		);
	});

	test('AC4: reveal requires text-editor focus and excludes the ECUC editor', () => {
		const reveal = itemsOf(readManifest(), SUBMENU_ID).find((item) => item.command === REVEAL_COMMAND);
		assert.ok(reveal, 'the reveal item exists');
		// Compare whole clauses, so an inverted key (`!editorTextFocus`) or a dropped
		// guard fails instead of matching a substring.
		assert.deepStrictEqual(
			(reveal!.when ?? '').split('&&').map((clause) => clause.trim()),
			[
				'resourceExtname == .arxml',
				`activeCustomEditorId != '${VIEW_TYPE}'`,
				'editorTextFocus',
			],
			'editorTextFocus keeps it out of the Explorer and the custom editor is excluded'
		);
	});

	test('AC5: explorer/context contributes the submenu and no direct reveal', () => {
		const items = itemsOf(readManifest(), 'explorer/context');
		const submenu = items.find((item) => item.submenu === SUBMENU_ID);
		assert.ok(submenu, 'explorer/context has the ARXML Scope submenu');
		assert.strictEqual(submenu!.when, 'resourceExtname == .arxml', 'the submenu stays limited to .arxml');
		assert.deepStrictEqual(
			items.filter((item) => item.command === OPEN_COMMAND),
			[],
			'the flat open entry was replaced by the submenu'
		);
		assert.deepStrictEqual(
			items.filter((item) => item.command === REVEAL_COMMAND),
			[],
			'no direct reveal entry'
		);
	});

	test('AC2/AC3: the submenu targets registered commands', async () => {
		const commands = await vscode.commands.getCommands(true);
		for (const id of [OPEN_COMMAND, REVEAL_COMMAND]) {
			assert.ok(commands.includes(id), `${id} is registered`);
		}
		// Menu visibility itself has no extension-host API. The `when` clauses are
		// asserted against the manifest above, and both commands are executed in
		// activation.test.ts; the rendered placement still needs a Development Host check.
	});
});
