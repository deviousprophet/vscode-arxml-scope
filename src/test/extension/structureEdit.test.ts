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
} from '../../host/ecucStructureEdit';
import { buildNodeIndex } from '../../core/ecuc/nodeId';
import type { NodeEntry } from '../../core/ecuc/nodeId';
import { fixtureText } from '../core/modelTestUtils';

const FIXTURE = 'editor/render.arxml';

function modelOf(text = fixtureText(FIXTURE)) {
	const model = scanEcucValues(text);
	return { model, index: buildNodeIndex(model) };
}

function shortNameLabel(node: NodeEntry['node']): string | undefined {
	return node.kind === 'module' || node.kind === 'container' ? node.shortName : undefined;
}

function nameLabel(node: NodeEntry['node']): string | undefined {
	return node.kind === 'parameter' || node.kind === 'reference' ? node.name : undefined;
}

function primaryLabel(node: NodeEntry['node']): string | undefined {
	return shortNameLabel(node) ?? nameLabel(node);
}

function matchesLabel(candidate: NodeEntry, kind: string, label: string): boolean {
	return candidate.kind === kind && primaryLabel(candidate.node) === label;
}

function idFor(kind: 'module' | 'container' | 'parameter' | 'reference', label: string): string {
	const { index } = modelOf();
	const entry = Array.from(index.byId.values()).find((candidate) => matchesLabel(candidate, kind, label));
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

suite('plan coverage: STRUCT', () => {
	const doc = (body: string, newline = '\n'): string =>
		[
			'<?xml version="1.0"?><AUTOSAR><AR-PACKAGES><AR-PACKAGE><SHORT-NAME>P</SHORT-NAME><ELEMENTS>',
			'<ECUC-MODULE-CONFIGURATION-VALUES><SHORT-NAME>M</SHORT-NAME><DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/M</DEFINITION-REF><CONTAINERS>',
			body,
			'</CONTAINERS></ECUC-MODULE-CONFIGURATION-VALUES>',
			'</ELEMENTS></AR-PACKAGE></AR-PACKAGES></AUTOSAR>'
		].join(newline);
	const container = (name: string, inner = ''): string =>
		`<ECUC-CONTAINER-VALUE><SHORT-NAME>${name}</SHORT-NAME><DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">/P/${name}</DEFINITION-REF>${inner}</ECUC-CONTAINER-VALUE>`;
	const reference = `<ECUC-REFERENCE-VALUE><DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/P/R</DEFINITION-REF><VALUE-REF DEST="ECUC-CONTAINER-VALUE">/P/C</VALUE-REF></ECUC-REFERENCE-VALUE>`;

	test('STRUCT-01 deleting the first or last child removes one line and keeps neighbours', () => {
		const text = doc([container('First'), container('Middle'), container('Last')].join('\n'));
		const model = scanEcucValues(text);
		const index = buildNodeIndex(model);
		const byName = (name: string) => index.idOf(model.modules[0].containers.find((entry) => entry.shortName === name)!)!;
		const first = planDelete(model, text, byName('First'));
		const last = planDelete(model, text, byName('Last'));
		assert.ok(first.ok && last.ok);
		for (const [plan, neighbour] of [
			[first, '<SHORT-NAME>Middle</SHORT-NAME>'],
			[last, '<SHORT-NAME>Middle</SHORT-NAME>']
		] as const) {
			assert.ok(plan.ok);
			const before = text.length;
			const span = lineSpan(text, { start: 0, end: 0 });
			assert.ok(span.start === 0, 'the helper agrees the document starts at 0');
			assert.strictEqual(plan.record.oldText.includes(neighbour), false);
			assert.ok(plan.record.oldText.length < before);
			assert.strictEqual(plan.record.oldText.endsWith('\n'), true, 'the line break goes with the element');
		}
	});

	test('STRUCT-02 deleting a reference-only container leaves no blank line', async () => {
		const original = doc([container('Keep'), container('RefOnly', `<REFERENCE-VALUES>${reference}</REFERENCE-VALUES>`), container('Tail')].join('\n'));
		const model = scanEcucValues(original);
		const index = buildNodeIndex(model);
		const refOnly = index.idOf(model.modules[0].containers.find((entry) => entry.shortName === 'RefOnly')!)!;
		const plan = planDelete(model, original, refOnly);
		assert.ok(plan.ok);
		const document = await copyDocument(original);
		const applied = await applyStructureEdit(document, plan.record);
		assert.ok(applied.ok, applied.ok ? '' : applied.reason);
		assert.ok(!/\n\s*\n\s*<ECUC-CONTAINER-VALUE><SHORT-NAME>Tail/.test(document.getText()), 'no blank line remains');
	});

	test('STRUCT-03 a container duplicate carries conditions and annotations verbatim', () => {
		const text = doc(
			container('C', '<SW-SYSCOND>(A == 1)</SW-SYSCOND><ANNOTATIONS><ECUC-ANNOTATION><ANNOTATION-TEXT><p><VERBATIM>note</VERBATIM></p></ANNOTATION-TEXT></ECUC-ANNOTATION></ANNOTATIONS>')
		);
		const model = scanEcucValues(text);
		const plan = planDuplicate(model, text, buildNodeIndex(model).idOf(model.modules[0].containers[0])!);
		assert.ok(plan.ok, plan.ok ? '' : plan.reason);
		assert.ok(plan.record.oldText.includes('<SW-SYSCOND>(A == 1)</SW-SYSCOND>'));
		assert.ok(plan.record.oldText.includes('VERBATIM>note</VERBATIM>'));
	});

	test('STRUCT-04 a CRLF document keeps CRLF in the inserted block', async () => {
		const original = doc(container('Line'), '\r\n');
		const model = scanEcucValues(original);
		const plan = planDuplicate(model, original, buildNodeIndex(model).idOf(model.modules[0].containers[0])!, 'Line_Copy');
		assert.ok(plan.ok, plan.ok ? '' : plan.reason);
		const document = await copyDocument(original);
		const applied = await applyStructureEdit(document, plan.record);
		assert.ok(applied.ok, applied.ok ? '' : applied.reason);
		const text = document.getText();
		const copyAt = text.indexOf('>Line_Copy</SHORT-NAME>');
		assert.ok(copyAt > 0);
		const lineStart = text.lastIndexOf('\r\n', copyAt);
		assert.ok(lineStart >= 0, 'the copied block is preceded by CRLF');
		assert.strictEqual(text.split('\r\n').length > 1, true);
		assert.ok(!/[^\r]\n/.test(text), 'no bare LF appears');
	});

	test('STRUCT-05 a second duplicate increments the suggestion', () => {
		assert.strictEqual(defaultDuplicateName('A', ['A_Copy']), 'A_Copy2');
		const text = doc(container('A'));
		const model = scanEcucValues(text);
		const id = buildNodeIndex(model).idOf(model.modules[0].containers[0])!;
		assert.ok(duplicateNameRefusal(model, id, 'A_Copy') === undefined);
		// After a copy exists, the same name is taken and the next suggestion moves on.
		const withCopy = text.replace(container('A'), [container('A'), container('A_Copy')].join('\n'));
		const next = scanEcucValues(withCopy);
		const nextId = buildNodeIndex(next).idOf(next.modules[0].containers[0])!;
		assert.ok(duplicateNameRefusal(next, nextId, 'A_Copy') !== undefined);
		const plan = planDuplicate(next, withCopy, nextId);
		assert.ok(plan.ok && plan.record.duplicateName === 'A_Copy2', plan.ok ? String(plan.record.duplicateName) : plan.reason);
	});

	test('STRUCT-06 an inline element is deleted by its exact range', () => {
		const text = '<A/><B/>';
		assert.deepStrictEqual(lineSpan(text, { start: 0, end: 4 }), { start: 0, end: 4 });
		assert.deepStrictEqual(lineSpan('<A/> <!-- keep -->\n', { start: 0, end: 4 }), { start: 0, end: 4 });
	});
});
