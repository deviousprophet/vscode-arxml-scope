import * as assert from 'assert';

import type { EcucRow } from '../../core/ecuc/renderRows';
import type { DiffCell, DiffDocument, DiffRow } from '../../core/diff/diffModel';
import { buildAlignedSyntheticDocuments, buildSyntheticDocument } from '../../webview/monaco/synthetic';

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
			'    Items "Items" @/P/Items',
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
			},
			{
				field: 'definitionRef',
				nodeId: 'container:m#0/c#0',
				startColumn: 20,
				endColumn: 28,
				text: '/P/Items'
			}
		]);
		assert.deepStrictEqual(document.foldingRanges, [
			{ startLine: 4, endLine: 10 },
			{ startLine: 6, endLine: 9 }
		]);
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
		assert.strictEqual(left.length, right.length);
	});
});
