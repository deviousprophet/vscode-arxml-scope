import * as assert from 'assert';

import type { EcucRow } from '../../core/ecuc/renderRows';
import type { DiffCell, DiffDocument, DiffRow } from '../../core/diff/diffModel';
import {
	compareEditFlushOrder,
	draftKey,
	remapDraftMap,
	remapDraftNodeId,
	remapNodeId,
	resolveRenameIntents,
	type RenameIntent
} from '../../core/ecuc/editOrder';
import { fieldTextFromWholeLine } from '../../core/ecuc/lineEdit';
import {
	buildAlignedSyntheticDocuments,
	buildSyntheticDocument,
	displayForRaw,
	searchRangeOnLine,
	spanTextForRaw
} from '../../webview/monaco/synthetic';

function moduleRow(): EcucRow {
	return {
		id: 'module:m#0',
		kind: 'module',
		level: 1,
		parentId: null,
		subtreeSize: 2,
		posinset: 1,
		setsize: 1,
		hasChildren: true,
		label: 'P.Preview',
		shortName: 'Preview',
		definitionRef: '/P/Preview',
		title: '/P/Preview',
		meta: [{ cls: 'short', text: '"Preview"', title: 'Preview' }],
		haystack: 'p.preview preview'
	};
}

function containerRow(): EcucRow {
	return {
		id: 'container:m#0/c#0',
		kind: 'container',
		level: 2,
		parentId: 'module:m#0',
		subtreeSize: 1,
		posinset: 1,
		setsize: 1,
		hasChildren: true,
		label: 'Items',
		shortName: 'Items',
		definitionRef: '/P/Items',
		title: '/P/Items',
		meta: [{ cls: 'short', text: '"Items"', title: 'Items' }],
		haystack: 'items items'
	};
}

function parameterRow(): EcucRow {
	return {
		id: 'container:m#0/c#0/param:P0000#0',
		kind: 'parameter',
		level: 3,
		parentId: 'container:m#0/c#0',
		subtreeSize: 0,
		posinset: 1,
		setsize: 1,
		hasChildren: false,
		label: 'P0000',
		definitionRef: '/P/P0000',
		value: '0',
		shownValue: '0',
		valueKind: 'numeric',
		title: '/P/P0000',
		meta: [],
		haystack: 'p0000 0'
	};
}

function rows(): EcucRow[] {
	return [moduleRow(), containerRow(), parameterRow()];
}

/** A textual parameter: the host value is bare and the shown value is quoted. */
function textualParameterRow(value = 'generated performance row 1'): EcucRow {
	return {
		...parameterRow(),
		id: 'container:m#0/c#0/param:Note#0',
		label: 'Note',
		value,
		shownValue: `"${value}"`,
		valueKind: 'textual',
		parameterType: 'String'
	};
}

function diffCell(row: EcucRow): DiffCell {
	return {
		kind: row.kind,
		label: row.label,
		shortName: row.shortName,
		definitionRef: row.definitionRef,
		shownValue: row.shownValue,
		value: row.value,
		meta: row.meta,
		range: { start: 0, end: 0 }
	};
}

function diffRow(row: EcucRow, status: DiffRow['status'], key: string): DiffRow {
	return {
		key,
		parentKey: row.parentId,
		level: row.level,
		posinset: row.posinset,
		setsize: row.setsize,
		kind: row.kind,
		hasChildren: row.hasChildren,
		subtreeSize: row.subtreeSize,
		status,
		left: diffCell(row),
		right: diffCell(row),
		changes: [],
		haystack: row.haystack
	};
}

suite('synthetic ECUC document', () => {
	test('serializes the Document rows, edits spans and folding ranges', () => {
		const document = buildSyntheticDocument(rows(), { schema: '00048', packages: ['P.Preview'] });
		const lines = document.text.split('\n');
		assert.deepStrictEqual(lines, [
			'schema 00048',
			'package P.Preview',
			'',
			'module P.Preview "Preview"',
			'{',
			'    Items "Items"',
			'    {',
			'        P0000 = 0',
			'    }',
			'}'
		]);
		assert.strictEqual(document.rowLine.get('module:m#0'), 4);
		assert.strictEqual(document.rowLine.get('container:m#0/c#0'), 6);
		assert.strictEqual(document.rowLine.get('container:m#0/c#0/param:P0000#0'), 8);

		const parameter = document.lines[7];
		assert.deepStrictEqual(parameter.fieldSpans, [
			{
				field: 'value',
				nodeId: 'container:m#0/c#0/param:P0000#0',
				startColumn: 17,
				endColumn: 18,
				text: '0'
			}
		]);
		const container = document.lines[5];
		assert.deepStrictEqual(container.fieldSpans, [
			{
				field: 'shortName',
				nodeId: 'container:m#0/c#0',
				startColumn: 12,
				endColumn: 17,
				text: 'Items'
			}
		]);
		assert.deepStrictEqual(document.foldingRanges, [
			{ startLine: 4, endLine: 10 },
			{ startLine: 6, endLine: 9 }
		]);
	});

	test('a textual value keeps its quotes outside the editable span', () => {
		const row = textualParameterRow();
		const document = buildSyntheticDocument([moduleRow(), containerRow(), row]);
		const line = document.lines[4];
		assert.strictEqual(line.text, '        Note = "generated performance row 1"');
		const span = line.fieldSpans[0];
		assert.strictEqual(span.field, 'value');
		assert.strictEqual(span.text, 'generated performance row 1');
		const opening = line.text.indexOf('"');
		assert.strictEqual(span.startColumn, opening + 2, 'the span starts after the opening quote');
		assert.strictEqual(span.endColumn, line.text.length, 'the span ends before the closing quote');
		assert.strictEqual(line.text[span.startColumn - 1], 'g');
		assert.strictEqual(line.text[span.startColumn - 2], '"');
		assert.strictEqual(line.text[span.endColumn - 1], '"');
	});

	test('displayForRaw builds the rendered fragment and spanTextForRaw keeps it bare', () => {
		const textual = textualParameterRow();
		assert.strictEqual(displayForRaw(textual, 'value', 'say "hi"'), '"say "hi""');
		assert.strictEqual(displayForRaw(textual, 'value', 'a\nb'), '"a\\nb"');
		assert.strictEqual(displayForRaw(textual, 'value', ''), '""');
		assert.strictEqual(displayForRaw(parameterRow(), 'value', '42'), '42');
		assert.strictEqual(displayForRaw(containerRow(), 'shortName', 'Items2'), 'Items2');
		assert.strictEqual(displayForRaw(containerRow(), 'definitionRef', '/P/Items2'), '/P/Items2');

		assert.strictEqual(spanTextForRaw(textual, 'value', 'say "hi"'), 'say "hi"');
		assert.strictEqual(spanTextForRaw(textual, 'value', 'a\nb'), 'a\\nb');
		assert.strictEqual(spanTextForRaw(textual, 'value', ''), '');
		assert.strictEqual(spanTextForRaw(parameterRow(), 'value', '42'), '42');
		assert.strictEqual(spanTextForRaw(containerRow(), 'shortName', 'Items'), 'Items');
	});

	test('an empty or quote-carrying textual value stays inside one pair of quotes', () => {
		const cases: [string, string][] = [
			['', '        Note = ""'],
			['say "hi"', '        Note = "say "hi""']
		];
		for (const [value, expected] of cases) {
			const document = buildSyntheticDocument([moduleRow(), containerRow(), textualParameterRow(value)]);
			const line = document.lines[4];
			assert.strictEqual(line.text, expected);
			const span = line.fieldSpans[0];
			assert.strictEqual(span.text, value);
			if (value === '') {
				assert.strictEqual(span.startColumn, span.endColumn, 'an empty value is a collapsed span between the quotes');
			}
		}
	});

	test('a numeric value that looks quoted stays bare', () => {
		const row: EcucRow = { ...parameterRow(), value: '"42"', shownValue: '"42"' };
		const document = buildSyntheticDocument([moduleRow(), containerRow(), row]);
		const line = document.lines[4];
		assert.strictEqual(line.text, '        P0000 = "42"');
		const span = line.fieldSpans[0];
		assert.strictEqual(span.text, '"42"');
		assert.strictEqual(span.startColumn, line.text.indexOf('= ') + 3);
		assert.strictEqual(span.endColumn, line.text.length + 1);
		assert.strictEqual(displayForRaw(row, 'value', '"42"'), '"42"', 'a numeric row never gains syntax quotes');
	});

	test('a container short name is the editable text inside its quotes', () => {
		const document = buildSyntheticDocument(rows());
		const line = document.lines[2];
		assert.strictEqual(line.text, '    Items "Items"');
		const span = line.fieldSpans.find((candidate) => candidate.field === 'shortName');
		assert.ok(span);
		const quoted = line.text.indexOf('"Items"');
		assert.strictEqual(span.startColumn, quoted + 2);
		assert.strictEqual(span.endColumn, quoted + 2 + 'Items'.length);
	});

	test('the flush order sends values first and renames deepest first', () => {
		const levels = new Map([
			['param', 4],
			['ref', 4],
			['parent', 2],
			['sibling', 3],
			['cousin', 3],
			['child', 4]
		]);
		const edits = [
			{ nodeId: 'parent', field: 'shortName' as const },
			{ nodeId: 'param', field: 'value' as const },
			{ nodeId: 'ref', field: 'definitionRef' as const },
			{ nodeId: 'sibling', field: 'shortName' as const },
			{ nodeId: 'cousin', field: 'shortName' as const },
			{ nodeId: 'child', field: 'shortName' as const }
		];
		const levelOf = (nodeId: string): number | undefined => levels.get(nodeId);
		const sorted = edits
			.slice()
			.sort((left, right) => compareEditFlushOrder(left, right, levelOf));
		assert.deepStrictEqual(
			sorted.map((edit) => edit.nodeId),
			['param', 'ref', 'child', 'sibling', 'cousin', 'parent'],
			'values keep insertion order, then renames deepest first and stable at equal depth'
		);
		const gone = [edits[0], edits[1]].sort((left, right) => compareEditFlushOrder(left, right, () => undefined));
		assert.deepStrictEqual(gone.map((edit) => edit.nodeId), ['param', 'parent'], 'a vanished row still sorts as a value/rename pair');
	});

	test('a rename re-keys the drafts addressed at the pre-rename id', () => {
		const oldId = 'container:P/Mod/BranchX#0';
		const newId = 'container:P/Mod/BranchX123456#0';
		assert.strictEqual(remapNodeId(oldId, oldId, newId), newId);
		assert.strictEqual(
			remapNodeId(`${oldId}/param:Note#0`, oldId, newId),
			`${newId}/param:Note#0`,
			'a parameter keeps its key under the renamed container'
		);
		assert.strictEqual(
			remapNodeId('container:P/Mod/BranchX/Child#0', oldId, newId),
			'container:P/Mod/BranchX123456/Child#0',
			'a nested container follows the renamed path segment'
		);
		assert.strictEqual(
			remapNodeId('container:P/Mod/BranchX/Child#0/ref:Next#0', oldId, newId),
			'container:P/Mod/BranchX123456/Child#0/ref:Next#0',
			'a nested reference follows the whole path'
		);
		assert.strictEqual(
			remapNodeId('container:P/Mod/BranchXY#0', oldId, newId),
			undefined,
			'a sibling sharing the prefix is not remapped'
		);
		assert.strictEqual(remapNodeId('container:P/Other#0', oldId, newId), undefined);
		assert.strictEqual(
			remapNodeId('container:P/Mod/BranchX/Child#0', oldId, 'container:P/Other#9'),
			'container:P/Other/Child#0',
			'the host pair is applied verbatim; the page never derives the new id'
		);
	});

	test('a rename intent outlives editResult and re-keys the post-flush draft', () => {
		const oldId = 'container:P/Mod/BranchX#0';
		const newId = 'container:P/Mod/BranchX123456#0';
		const intent: RenameIntent = { editId: 7, nodeId: oldId, shortName: 'BranchX123456' };
		const rowOf = (id: string): { kind: string; shortName?: string } | undefined => {
			if (id === oldId) {
				return { kind: 'container', shortName: 'BranchX' };
			}
			return id === newId ? { kind: 'container', shortName: 'BranchX123456' } : undefined;
		};

		// Flush -> editResult ok: the host pair is known but the old row is still the
		// only one the page knows, so the intent keeps the next flush deferred.
		const acknowledged: RenameIntent = { ...intent, nextNodeId: newId };
		const beforeScan = resolveRenameIntents([acknowledged], rowOf);
		assert.deepStrictEqual(beforeScan.resolved, []);
		assert.deepStrictEqual(beforeScan.kept.map((kept) => kept.editId), [7]);
		assert.deepStrictEqual(beforeScan.dropped, []);

		// The value typed after the first Ctrl+S is still keyed by the pre-rename id.
		const draftNodeId = `${oldId}/param:Note#0`;
		const pending = new Map([[draftKey(draftNodeId, 'value'), { nodeId: draftNodeId, field: 'value' as const }]]);
		const inflight = new Map([[9, { editId: 9, nodeId: draftNodeId, field: 'value' as const }]]);

		// The re-scan proves the new container: the draft is re-keyed and the intent
		// is resolved between the two ids.
		const afterScan = resolveRenameIntents([acknowledged], (id) => {
			return id === oldId ? undefined : id === newId ? { kind: 'container', shortName: 'BranchX123456' } : rowOf(id);
		});
		assert.deepStrictEqual(afterScan.resolved, [{ oldId, newId }]);
		assert.deepStrictEqual(afterScan.kept, []);
		assert.deepStrictEqual(afterScan.dropped, []);
		for (const pair of afterScan.resolved) {
			remapDraftMap(pending, pair.oldId, pair.newId);
			for (const [editId, edit] of Array.from(inflight)) {
				const next = remapDraftNodeId(edit, pair.oldId, pair.newId);
				if (next !== undefined) {
					inflight.set(editId, next);
				}
			}
		}
		assert.deepStrictEqual([...pending.keys()], [draftKey(`${newId}/param:Note#0`, 'value')]);
		assert.strictEqual(inflight.get(9)?.nodeId, `${newId}/param:Note#0`, 'the in-flight entry moves too');
	});

	test('a refusal after the rename document lands is recorded at the new id', () => {
		const oldId = 'container:P/Mod/BranchX#0';
		const newId = 'container:P/Mod/BranchX123456#0';
		// The page flushed a value draft under the pre-rename container, then the
		// rename document arrived and moved both maps to the host id. The refusal for
		// the in-flight value edit may arrive after that, so it must be keyed by the
		// new node id or the Details selection would target a dead one.
		const inflight = new Map([[11, { editId: 11, nodeId: `${oldId}/param:Note#0`, field: 'value' as const }]]);
		const moved = remapDraftNodeId(inflight.get(11)!, oldId, newId);
		assert.ok(moved);
		inflight.set(11, moved);
		const refused = inflight.get(11)!;
		assert.strictEqual(refused.nodeId, `${newId}/param:Note#0`);
		assert.strictEqual(
			draftKey(refused.nodeId, refused.field),
			draftKey(`${newId}/param:Note#0`, 'value'),
			'the refusal is recorded under the host id, not the pre-rename id'
		);
		assert.notStrictEqual(
			refused.nodeId,
			`${oldId}/param:Note#0`,
			'the dead id is never the Details target'
		);
	});

	test('a refused rename forgets its intent and leaves the old-row draft addressable', () => {
		const oldId = 'container:P/Mod/BranchX#0';
		const intents = new Map<number, RenameIntent>([
			[7, { editId: 7, nodeId: oldId, shortName: 'BranchX123456' }]
		]);
		intents.delete(7);
		assert.strictEqual(intents.size, 0, 'the refusal clears the intent');
		const plan = resolveRenameIntents(Array.from(intents.values()), (id) => {
			return id === oldId ? { kind: 'container', shortName: 'BranchX' } : undefined;
		});
		assert.deepStrictEqual(plan.kept, [], 'nothing is left to defer a flush');
		assert.deepStrictEqual(plan.resolved, [], 'no id is rewritten after a refusal');
		// The refused row is still present in the host, so the untouched draft keeps
		// its pre-rename id and the next flush addresses the row the host still knows.
		assert.strictEqual(plan.dropped.length, 0);
	});

	test('a rename whose host row vanished is dropped instead of predicted', () => {
		const oldId = 'container:P/Mod/BranchX#0';
		const plan = resolveRenameIntents(
			[{ editId: 3, nodeId: oldId, shortName: 'BranchX', nextNodeId: 'container:P/Mod/BranchX#1' }],
			() => undefined
		);
		assert.deepStrictEqual(plan.resolved, []);
		assert.deepStrictEqual(plan.kept, []);
		assert.deepStrictEqual(plan.dropped, [3], 'the page never invents the missing id');
	});

	test('nested rename intents resolve to a fixed point from the host pairs', () => {
		const parent = 'container:P/Mod/Outer#0';
		const child = 'container:P/Mod/Outer/Child#0';
		const newParent = 'container:P/Mod/Outer2#0';
		// The host planned the child against the pre-rename parent path, so the page
		// composes it with the parent pair instead of re-deriving the id.
		const plannedChild = 'container:P/Mod/Outer/Child2#0';
		const newChild = 'container:P/Mod/Outer2/Child2#0';
		const intents: RenameIntent[] = [
			{ editId: 2, nodeId: child, shortName: 'Child2', nextNodeId: plannedChild },
			{ editId: 1, nodeId: parent, shortName: 'Outer2', nextNodeId: newParent }
		];
		const rows = new Map([
			[newParent, { kind: 'container', shortName: 'Outer2' }],
			[newChild, { kind: 'container', shortName: 'Child2' }]
		]);
		const plan = resolveRenameIntents(intents, (id) => rows.get(id));
		assert.deepStrictEqual(
			new Map(plan.resolved.map((pair) => [pair.oldId, pair.newId])),
			new Map([
				[parent, newParent],
				[child, newChild]
			]),
			'the child composes with the parent before its candidate is looked up'
		);
		assert.deepStrictEqual(
			plan.resolved.map((pair) => pair.oldId),
			[child, parent],
			'the deepest id is rewritten first'
		);
		let draftId = `${child}/param:Note#0`;
		for (const pair of plan.resolved) {
			draftId = remapNodeId(draftId, pair.oldId, pair.newId) ?? draftId;
		}
		assert.strictEqual(draftId, `${newChild}/param:Note#0`, 'the child draft follows both renames');
		assert.deepStrictEqual(plan.kept, []);
		assert.deepStrictEqual(plan.dropped, []);
	});

	test('a whole-line repaint is attributed to the field it changed', () => {
		const document = buildSyntheticDocument([moduleRow(), containerRow(), textualParameterRow('hello updated')]);
		const line = document.lines[4];
		assert.strictEqual(
			fieldTextFromWholeLine(line.text, line.fieldSpans, '        Note = "hello"'),
			'hello',
			'undoing the repaint returns the previous raw value'
		);
		assert.strictEqual(
			fieldTextFromWholeLine(line.text, line.fieldSpans, '        Note = "generated performance row 1"'),
			'generated performance row 1',
			'an intermediate draft is not mistaken for syntax'
		);
		assert.strictEqual(
			fieldTextFromWholeLine('        Note = "say "hi""', buildSyntheticDocument([moduleRow(), containerRow(), textualParameterRow('say "hi"')]).lines[4].fieldSpans, '        Note = "say "hi" bye"'),
			'say "hi" bye',
			'a value that itself contains quotes keeps them'
		);
		assert.strictEqual(
			fieldTextFromWholeLine(line.text, line.fieldSpans, '        Xote = "hello"'),
			undefined,
			'a changed prefix is a syntax edit, not a field edit'
		);
		assert.strictEqual(
			fieldTextFromWholeLine(line.text, line.fieldSpans, '        Note = "hello'),
			undefined,
			'a lost suffix is a syntax edit'
		);
		assert.strictEqual(
			fieldTextFromWholeLine(line.text, [], '        Note = "hello"'),
			undefined,
			'a line without exactly one span has no field to attribute'
		);
	});

	test('maps Rust field offsets onto the rendered synthetic line', () => {
		const document = buildSyntheticDocument(rows(), { schema: '00048', packages: ['P.Preview'] });
		const containerLine = document.lines[5];
		assert.deepStrictEqual(
			searchRangeOnLine(containerLine, { field: 'label', start: 0, end: 5 }),
			{ startColumn: 5, endColumn: 10 },
			'the container label maps to the rendered label text'
		);
		assert.deepStrictEqual(
			searchRangeOnLine(containerLine, { field: 'meta', part: 0, start: 1, end: 6 }),
			{ startColumn: 12, endColumn: 17 },
			'the short name inside quotes maps inside the meta span'
		);
		assert.strictEqual(
			searchRangeOnLine(containerLine, { field: 'meta', start: 1, end: 6 }),
			undefined,
			'a meta match without its part index cannot slice another part'
		);
		assert.deepStrictEqual(
			searchRangeOnLine(document.lines[7], { field: 'value', start: 0, end: 1 }),
			{ startColumn: 17, endColumn: 18 },
			'the value maps after the label and separator'
		);
	});

	test('the aligned diff documents have equal line counts', () => {
		const rowsModel = rows();
		const document: DiffDocument = {
			left: { name: 'left.arxml', path: 'left.arxml' },
			right: { name: 'right.arxml', path: 'right.arxml' },
			leftHeader: { packages: ['P.Preview'] },
			rightHeader: { schema: '00048', packages: ['P.Preview'] },
			labels: ['left.arxml', 'right.arxml'],
			rows: [
				diffRow(rowsModel[0], 'changed', 'module:m#0'),
				diffRow(rowsModel[1], 'unchanged', 'container:m#0/c#0'),
				diffRow(rowsModel[2], 'changed', 'container:m#0/c#0/param:P0000#0')
			],
			summary: { changed: 2, added: 0, removed: 0, unchanged: 1, renamed: 0 },
			semanticSkipped: 0
		};
		const aligned = buildAlignedSyntheticDocuments(document);
		const left = aligned.left.text.split('\n');
		const right = aligned.right.text.split('\n');
		assert.strictEqual(left.length, right.length);
		assert.strictEqual(left[0], 'module P.Preview "Preview"');
		assert.strictEqual(right[0], 'module P.Preview "Preview"');
		assert.strictEqual(left[1], '{');
		assert.strictEqual(right[1], '{');
		assert.deepStrictEqual(
			searchRangeOnLine(aligned.right.lines[0], { field: 'label', start: 0, end: 9 }),
			{ startColumn: 8, endColumn: 17 },
			'the diff label span skips the module keyword'
		);
		assert.deepStrictEqual(
			searchRangeOnLine(aligned.right.lines[0], { field: 'meta', part: 0, start: 1, end: 8 }),
			{ startColumn: 19, endColumn: 26 },
			'the diff meta span maps inside the quoted short name'
		);
		assert.strictEqual(left.length, right.length);
	});
});
