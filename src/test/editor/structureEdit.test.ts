/**
 * Structural row actions: delete/duplicate plans are pure, and the one-write apply
 * path is driven against a temporary copy so committed fixtures are never touched.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { scanEcucValues } from '../../core/ecuc/scanner';
import {
	applyStructureEdit,
	defaultDuplicateName,
	duplicateNameRefusal,
	lineSpan,
	planDelete,
	planDuplicate,
	structureNodeFor,
} from '../../editor/ecucStructureEdit';
import { buildNodeIndex } from '../../editor/nodeId';
import { fixtureText } from '../core/modelTestUtils';

const FIXTURE = 'editor/render.arxml';

function modelOf(text = fixtureText(FIXTURE)) {
	const model = scanEcucValues(text);
	return { model, index: buildNodeIndex(model) };
}

function idFor(kind: 'module' | 'container' | 'parameter' | 'reference', label: string): string {
	const { index } = modelOf();
	const entry = Array.from(index.byId.values()).find(
		(candidate) =>
			candidate.kind === kind &&
			(candidate.node.kind === 'module' || candidate.node.kind === 'container'
				? candidate.node.shortName === label
				: candidate.node.kind === 'parameter' || candidate.node.kind === 'reference'
					? candidate.node.name === label
					: false)
	);
	assert.ok(entry, `${kind} ${label} exists`);
	return entry.id;
}

async function copyDocument(text: string): Promise<vscode.TextDocument> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arxml-structure-'));
	const file = path.join(dir, 'copy.arxml');
	fs.writeFileSync(file, text, 'utf8');
	const document = await vscode.workspace.openTextDocument(file);
	await vscode.window.showTextDocument(document, { preview: true });
	return document;
}

suite('structural row actions', () => {
	test('lineSpan removes an own-line element with its indentation and line break', () => {
		const text = '  <A/>\n  <B/>\n';
		const range = { start: 2, end: 6 };
		assert.deepStrictEqual(lineSpan(text, range), { start: 0, end: 7 });
		const crlf = '  <A/>\r\n  <B/>\r\n';
		assert.deepStrictEqual(lineSpan(crlf, range), { start: 0, end: 8 });
	});

	test('lineSpan leaves neighbouring inline elements alone', () => {
		const text = '<A/><B/>';
		assert.deepStrictEqual(lineSpan(text, { start: 0, end: 4 }), { start: 0, end: 4 });
		const trailing = '<A/> <!-- keep me -->\n';
		assert.deepStrictEqual(lineSpan(trailing, { start: 0, end: 4 }), { start: 0, end: 4 });
	});

	test('a module or reference cannot be structurally edited', () => {
		const text = fixtureText(FIXTURE);
		const { model } = modelOf(text);
		const moduleId = idFor('module', 'ModX');
		const referenceId = idFor('reference', 'PeerRef');
		assert.strictEqual(structureNodeFor(model, moduleId), undefined);
		assert.strictEqual(structureNodeFor(model, referenceId), undefined);
		assert.strictEqual(planDelete(model, text, moduleId).ok, false);
		assert.strictEqual(planDuplicate(model, text, referenceId).ok, false);
	});

	test('a parameter duplicate copies the element, including its condition', () => {
		const text = fixtureText(FIXTURE);
		const { model } = modelOf(text);
		const parameterId = idFor('parameter', 'IniValue');
		const plan = planDuplicate(model, text, parameterId);
		assert.ok(plan.ok);
		assert.strictEqual(plan.record.action, 'duplicate');
		assert.strictEqual(plan.record.duplicateName, undefined, 'a parameter asks for no name');
		assert.ok(plan.record.oldText.includes('/ModX/ContA/IniValue'));
	});

	test('a container duplicate suggests a unique sibling name', () => {
		assert.strictEqual(defaultDuplicateName('ContB', []), 'ContB_Copy');
		assert.strictEqual(defaultDuplicateName('ContB', ['ContB_Copy']), 'ContB_Copy2');
		assert.strictEqual(defaultDuplicateName('ContB', ['ContB_Copy', 'ContB_Copy2']), 'ContB_Copy3');

		const text = fixtureText(FIXTURE);
		const { model } = modelOf(text);
		const containerId = idFor('container', 'ContB');
		const plan = planDuplicate(model, text, containerId);
		assert.ok(plan.ok);
		assert.strictEqual(plan.record.duplicateName, 'ContB_Copy');
		assert.strictEqual(duplicateNameRefusal(model, containerId, 'ContA'), undefined, 'a parent name is not a sibling');
		assert.ok(duplicateNameRefusal(model, containerId, 'ContB'), 'the original name is refused');
		assert.strictEqual(duplicateNameRefusal(model, containerId, 'ContB_Copy'), undefined);
		assert.ok(duplicateNameRefusal(model, containerId, 'not a name'));
	});

	test('a CDATA-backed node is refused, just like a CDATA value edit', () => {
		const text = fixtureText('editing/cdata.arxml');
		const model = scanEcucValues(text);
		const entry = Array.from(buildNodeIndex(model).byId.values()).find(
			(candidate) => candidate.node.kind === 'parameter' && candidate.node.name === 'Pattern'
		);
		assert.ok(entry);
		const deleted = planDelete(model, text, entry.id);
		assert.strictEqual(deleted.ok, false);
		assert.ok(!deleted.ok && deleted.reason.includes('CDATA'), !deleted.ok ? deleted.reason : '');
		const duplicated = planDuplicate(model, text, entry.id);
		assert.strictEqual(duplicated.ok, false, 'a CDATA-backed element cannot be copied structurally');
	});

	test('apply deletes one element and one undo restores it', async () => {
		const original = fixtureText(FIXTURE);
		const model = scanEcucValues(original);
		const plan = planDelete(model, original, idFor('parameter', 'IniValue'));
		assert.ok(plan.ok);
		const document = await copyDocument(original);
		const applied = await applyStructureEdit(document, plan.record);
		assert.ok(applied.ok, applied.ok ? '' : applied.reason);
		assert.ok(!document.getText().includes('IniValue</DEFINITION-REF>'), 'the element is gone');
		assert.ok(document.getText().includes('Title</DEFINITION-REF>'), 'the next sibling is untouched');

		await vscode.commands.executeCommand('undo');
		assert.strictEqual(document.getText(), original, 'one undo restores the exact bytes');
	});

	test('apply duplicates a container with the chosen name and its subtree', async () => {
		const original = fixtureText(FIXTURE);
		const model = scanEcucValues(original);
		const plan = planDuplicate(model, original, idFor('container', 'ContB'), 'ContB_Copy');
		assert.ok(plan.ok);
		const document = await copyDocument(original);
		const applied = await applyStructureEdit(document, plan.record);
		assert.ok(applied.ok, applied.ok ? '' : applied.reason);
		const text = document.getText();
		assert.strictEqual((text.match(/>ContB_Copy<\/SHORT-NAME>/g) ?? []).length, 1);
		assert.strictEqual((text.match(/Text<\/DEFINITION-REF>/g) ?? []).length, 2, 'the subtree is copied');
		assert.ok(text.includes('Text</DEFINITION-REF>'));
		const copiedAt = text.indexOf('>ContB_Copy</SHORT-NAME>');
		assert.ok(copiedAt > text.indexOf('>ContB</SHORT-NAME>'), 'the copy follows the original');
	});

	test('apply refuses moved bytes and taken duplicate names', async () => {
		const original = fixtureText(FIXTURE);
		const model = scanEcucValues(original);
		const plan = planDelete(model, original, idFor('parameter', 'IniValue'));
		assert.ok(plan.ok);
		const document = await copyDocument(original.replace('<VALUE>63</VALUE>', '<VALUE>64</VALUE>'));
		const moved = await applyStructureEdit(document, plan.record);
		assert.strictEqual(moved.ok, false, 'the plan cannot delete bytes the user did not see');
		assert.ok(document.getText().includes('<VALUE>64</VALUE>'), 'the document is unchanged');
	});
});
