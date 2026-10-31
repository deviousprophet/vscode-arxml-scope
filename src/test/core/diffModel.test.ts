/**
 * The semantic diff model (task design §2, §3.3; prd AC2–AC6).
 *
 * The fixtures are built through `scanEcucValues` and the production row builder,
 * so a test exercises the same ids and display order the panel will see. The page
 * helpers are the real exported functions; no host-side twin is asserted.
 */
import * as assert from 'assert';

import { SORT_EXCEPTIONS } from '../../core/ecuc/order';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { DiffCell, DiffRow, buildDiffDocument, compareTitle, diffChanges, diffVisibility, disambiguatedLabels, flattenDiffRows, nextChangeIndex } from '../../core/diff/diffModel';
import { buildNodeIndex } from '../../core/ecuc/nodeId';
import { EcucRow, buildRows } from '../../core/ecuc/renderRows';
import { fixtureText } from '../core/modelTestUtils';

interface Side {
	rows: EcucRow[];
	rangeOf: (id: string) => { start: number; end: number } | undefined;
}

function side(text: string): Side {
	const model = scanEcucValues(text);
	const index = buildNodeIndex(model);
	const rows = buildRows(model, { sort: 'all', sortExcept: SORT_EXCEPTIONS }).rows;
	return { rows, rangeOf: (id) => index.byId.get(id)?.range };
}

function diffOf(leftText: string, rightText: string) {
	const left = side(leftText);
	const right = side(rightText);
	const document = buildDiffDocument(
		{ name: 'left.arxml', path: '/work/left.arxml' },
		{ name: 'right.arxml', path: '/work/right.arxml' },
		left.rows,
		right.rows,
		left.rangeOf,
		right.rangeOf
	);
	return { document, left, right };
}

function rowByLabel(rows: readonly DiffRow[], label: string): DiffRow {
	const row = rows.find((candidate) => {
		const owner = candidate.left ?? candidate.right;
		return owner ? owner.label === label : false;
	});
	assert.ok(row, `a row labelled "${label}" exists`);
	return row!;
}

/* ------------------------------------------------------------------ *
 * Inline synthetic models. Every helper emits a valid ECUC Values file.
 * ------------------------------------------------------------------ */

function arxml(...elements: string[]): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0">
	<AR-PACKAGES>
		<AR-PACKAGE>
			<SHORT-NAME>P</SHORT-NAME>
			<ELEMENTS>
				${elements.join('\n')}
			</ELEMENTS>
		</AR-PACKAGE>
	</AR-PACKAGES>
</AUTOSAR>`;
}

function module(shortName: string, containers: string): string {
	return `<ECUC-MODULE-CONFIGURATION-VALUES>
	<SHORT-NAME>${shortName}</SHORT-NAME>
	<DEFINITION-REF DEST="ECUC-MODULE-DEF">/P/${shortName}</DEFINITION-REF>
	<CONTAINERS>${containers}</CONTAINERS>
</ECUC-MODULE-CONFIGURATION-VALUES>`;
}

function parameter(name: string, value: string, textual = false): string {
	const tag = textual ? 'ECUC-TEXTUAL-PARAM-VALUE' : 'ECUC-NUMERICAL-PARAM-VALUE';
	const dest = textual ? 'ECUC-STRING-PARAM-DEF' : 'ECUC-INTEGER-PARAM-DEF';
	return `<${tag}>
	<DEFINITION-REF DEST="${dest}">/P/${name}</DEFINITION-REF>
	<VALUE>${value}</VALUE>
</${tag}>`;
}

function reference(name: string, target: string): string {
	return `<ECUC-REFERENCE-VALUE>
	<DEFINITION-REF DEST="ECUC-REFERENCE-DEF">/P/${name}</DEFINITION-REF>
	<VALUE-REF DEST="ECUC-CONTAINER-VALUE">${target}</VALUE-REF>
</ECUC-REFERENCE-VALUE>`;
}

function container(
	shortName: string,
	options: {
		parameters?: string[];
		references?: string[];
		containers?: string[];
		definitionRef?: string;
		condition?: string;
	} = {}
): string {
	const parameters = options.parameters ?? [];
	const references = options.references ?? [];
	const containers = options.containers ?? [];
	return `<ECUC-CONTAINER-VALUE>
	<SHORT-NAME>${shortName}</SHORT-NAME>
	<DEFINITION-REF DEST="ECUC-PARAM-CONF-CONTAINER-DEF">${options.definitionRef ?? `/P/${shortName}`}</DEFINITION-REF>
	${options.condition ? `<SW-SYSCOND>${options.condition}</SW-SYSCOND>` : ''}
	${parameters.length > 0 ? `<PARAMETER-VALUES>${parameters.join('')}</PARAMETER-VALUES>` : ''}
	${references.length > 0 ? `<REFERENCE-VALUES>${references.join('')}</REFERENCE-VALUES>` : ''}
	${containers.length > 0 ? `<SUB-CONTAINERS>${containers.join('')}</SUB-CONTAINERS>` : ''}
</ECUC-CONTAINER-VALUE>`;
}

function cell(overrides: Partial<DiffCell> = {}): DiffCell {
	return {
		kind: 'parameter',
		label: 'Speed',
		definitionRef: '/P/Speed',
		shownValue: '10',
		value: '10',
		valueKind: 'numeric',
		meta: [],
		range: { start: 0, end: 10 },
		...overrides,
	};
}

suite('semantic diff model (design §2, §3.3)', () => {
	test('AC2: a file compared with itself has no differences', () => {
		const text = arxml(
			module(
				'M1',
				container('C1', {
					parameters: [parameter('A', '1'), parameter('B', 'true')],
					references: [reference('R', '/P/C1')],
				})
			)
		);
		const { document } = diffOf(text, text);
		assert.deepStrictEqual(document.summary, { changed: 0, added: 0, removed: 0, unchanged: document.rows.length });
		assert.ok(document.rows.length >= 4, 'the file has rows to compare');
		assert.ok(document.rows.every((row) => row.status === 'unchanged'));
	});

	test('AC3: a changed parameter is exactly one changed row with both values', () => {
		const left = arxml(module('M1', container('C1', { parameters: [parameter('Speed', '10')] })));
		const right = arxml(module('M1', container('C1', { parameters: [parameter('Speed', '11')] })));
		const { document } = diffOf(left, right);
		assert.strictEqual(document.summary.changed, 1);
		assert.strictEqual(document.summary.added, 0);
		assert.strictEqual(document.summary.removed, 0);
		const changed = document.rows.filter((row) => row.status === 'changed');
		assert.strictEqual(changed.length, 1);
		assert.strictEqual(changed[0].left?.shownValue, '10');
		assert.strictEqual(changed[0].right?.shownValue, '11');
		assert.deepStrictEqual(changed[0].changes, [{ field: 'value', left: '10', right: '11' }]);
	});

	test('search haystack includes condition/meta text from both sides', () => {
		const left = arxml(module('M1', container('C1', { condition: '(CANIPCORETYPE_SC==0)' })));
		const right = arxml(module('M1', container('C1', { condition: '(CANIPCORETYPE_SC==1)' })));
		const { document } = diffOf(left, right);
		const row = rowByLabel(document.rows, 'C1');
		assert.ok(row.haystack.includes('canipcoretype_sc'), row.haystack);
		assert.ok(row.haystack.includes('==0') && row.haystack.includes('==1'), 'both sides contribute');
	});

	test('R6: every compared field is reported once, and annotation/meta derivatives are ignored', () => {
		const base = cell();
		const differing = cell({
			value: '11',
			target: '/P/T2',
			shortName: 'Speed2',
			definitionRef: '/P/Speed2',
			definitionDest: 'ECUC-BOOLEAN-PARAM-DEF',
			meta: [
				{ cls: 'variant', text: '(V2)', title: '(V2)' },
				{ cls: 'condition', text: '[(A == B)]', title: '[(A == B)]' },
				{ cls: 'context', text: 'context /P/C2', title: 'context /P/C2' },
			],
		});
		const changes = diffChanges(base, differing);
		assert.deepStrictEqual(
			changes.map((change) => change.field),
			[
				'value',
				'target',
				'short name',
				'definition ref',
				'definition dest',
				'variant',
				'condition',
				'context',
			]
		);
		assert.deepStrictEqual(
			diffChanges(base, cell({ definitionDest: 'ECUC-BOOLEAN-PARAM-DEF' })).map((change) => change.field),
			['definition dest'],
			'a DEST-only change is a configuration change'
		);
		const annotationOnly = cell({
			meta: [{ cls: 'annotation', text: '[note] comment', title: '[note] comment' }],
		});
		assert.deepStrictEqual(diffChanges(base, annotationOnly), [], 'a comment-only change is not a change');
		const derivedOnly = cell({ label: 'Other' });
		assert.deepStrictEqual(diffChanges(base, derivedOnly), [], 'label is a derivative');
		assert.deepStrictEqual(
			diffChanges(
				cell({ value: 'x', shownValue: 'x', valueKind: 'numeric' }),
				cell({ value: 'x', shownValue: '"x"', valueKind: 'textual' })
			).map((change) => change.field),
			['shown value'],
			'a mistyped tag shows its display difference instead of comparing equal'
		);
	});

	test('AC4: an added container marks every descendant added; a removed one marks every descendant removed', () => {
		const base = arxml(module('M1', container('Keep', { parameters: [parameter('KeepValue', '1')] })));
		const extra = container('Added', {
			parameters: [parameter('AddedParam', '2')],
			containers: [container('AddedNested', { parameters: [parameter('NestedParam', '3')] })],
		});
		const withExtra = arxml(module('M1', container('Keep', { parameters: [parameter('KeepValue', '1')] }) + extra));
		const added = diffOf(base, withExtra).document;
		assert.strictEqual(added.summary.added, 4, 'the container, its parameter and two nested rows');
		assert.strictEqual(added.summary.removed, 0);
		for (const label of ['Added', 'AddedParam', 'AddedNested', 'NestedParam']) {
			assert.strictEqual(rowByLabel(added.rows, label).status, 'added', label);
		}
		assert.strictEqual(rowByLabel(added.rows, 'Keep').status, 'unchanged');

		const removed = diffOf(withExtra, base).document;
		assert.strictEqual(removed.summary.removed, 4);
		assert.strictEqual(removed.summary.added, 0);
		for (const label of ['Added', 'AddedParam', 'AddedNested', 'NestedParam']) {
			assert.strictEqual(rowByLabel(removed.rows, label).status, 'removed', label);
		}
	});

	test('AC5: reordered modules, containers, parameters and references compare equal', () => {
		const forward = arxml(
			module(
				'M1',
				container('C1', {
					parameters: [parameter('A', '1'), parameter('B', '2')],
					references: [reference('R1', '/P/C1'), reference('R2', '/P/C2')],
				}) +
					container('C2', { parameters: [parameter('D', '4'), parameter('E', '5')] })
			) +
				module('M2', container('C3', { parameters: [parameter('F', '6')] }))
		);
		const reversed = arxml(
			module('M2', container('C3', { parameters: [parameter('F', '6')] })) +
				module(
					'M1',
					container('C2', { parameters: [parameter('E', '5'), parameter('D', '4')] }) +
						container('C1', {
							references: [reference('R2', '/P/C2'), reference('R1', '/P/C1')],
							parameters: [parameter('B', '2'), parameter('A', '1')],
						})
				)
		);
		const { document } = diffOf(forward, reversed);
		assert.deepStrictEqual(
			document.summary,
			{ changed: 0, added: 0, removed: 0, unchanged: document.rows.length },
			'declaration order is not a difference'
		);
	});

	test('AC5: swapping two same-named sibling parameters compares equal (base-id identity)', () => {
		const left = arxml(
			module(
				'M1',
				container('C1', {
					parameters: [parameter('Dup', 'alpha', true), parameter('Dup', 'beta', true)],
				})
			)
		);
		const right = arxml(
			module(
				'M1',
				container('C1', {
					parameters: [parameter('Dup', 'beta', true), parameter('Dup', 'alpha', true)],
				})
			)
		);
		const { document } = diffOf(left, right);
		assert.strictEqual(document.summary.changed, 0);
		assert.strictEqual(document.summary.added, 0);
		assert.strictEqual(document.summary.removed, 0);
		const dups = document.rows.filter((row) => (row.left ?? row.right)?.label === 'Dup');
		assert.strictEqual(dups.length, 2);
		assert.ok(dups.every((row) => row.status === 'unchanged'));
	});

	test('AC5: reordered duplicate-name containers keep their children paired across the ordinal shift', () => {
		const left = arxml(
			module(
				'M1',
				container('C1', {
					containers: [
						container('Dup', { definitionRef: '/P/X', parameters: [parameter('V', '1')] }),
						container('Dup', { definitionRef: '/P/Y', parameters: [parameter('W', '2')] }),
					],
				})
			)
		);
		const right = arxml(
			module(
				'M1',
				container('C1', {
					containers: [
						container('Dup', { definitionRef: '/P/Y', parameters: [parameter('W', '2')] }),
						container('Dup', { definitionRef: '/P/X', parameters: [parameter('V', '1')] }),
					],
				})
			)
		);
		const { document } = diffOf(left, right);
		assert.deepStrictEqual(
			document.summary,
			{ changed: 0, added: 0, removed: 0, unchanged: document.rows.length },
			'a duplicate container reorder is not a change at any depth'
		);
	});

	test('AC5: reordered duplicates that differ only in a condition compare equal', () => {
		const left = arxml(
			module(
				'M1',
				container('C1', {
					containers: [
						container('Dup', { definitionRef: '/P/D', condition: '(A == 1)' }),
						container('Dup', { definitionRef: '/P/D', condition: '(A == 2)' }),
					],
				})
			)
		);
		const right = arxml(
			module(
				'M1',
				container('C1', {
					containers: [
						container('Dup', { definitionRef: '/P/D', condition: '(A == 2)' }),
						container('Dup', { definitionRef: '/P/D', condition: '(A == 1)' }),
					],
				})
			)
		);
		const { document } = diffOf(left, right);
		assert.deepStrictEqual(
			document.summary,
			{ changed: 0, added: 0, removed: 0, unchanged: document.rows.length },
			'exact content pairs the two declared conditions'
		);
	});

	test('AC5: reordered duplicate-name containers with different contents compare equal', () => {
		const left = arxml(
			module(
				'M1',
				container('C1', {
					containers: [
						container('Dup', { definitionRef: '/P/D', parameters: [parameter('V', '1')] }),
						container('Dup', { definitionRef: '/P/D', parameters: [parameter('V', '2')] }),
					],
				})
			)
		);
		const right = arxml(
			module(
				'M1',
				container('C1', {
					containers: [
						container('Dup', { definitionRef: '/P/D', parameters: [parameter('V', '2')] }),
						container('Dup', { definitionRef: '/P/D', parameters: [parameter('V', '1')] }),
					],
				})
			)
		);
		const { document } = diffOf(left, right);
		assert.deepStrictEqual(
			document.summary,
			{ changed: 0, added: 0, removed: 0, unchanged: document.rows.length },
			'subtree content pairs the two instances, not their positions'
		);
	});

	test('AC5/R6: a reordered duplicate container with one changed child stays one changed row', () => {
		const left = arxml(
			module(
				'M1',
				container('C1', {
					containers: [
						container('Dup', { definitionRef: '/P/D', parameters: [parameter('V', '1')] }),
						container('Dup', { definitionRef: '/P/D', parameters: [parameter('V', '2')] }),
					],
				})
			)
		);
		const right = arxml(
			module(
				'M1',
				container('C1', {
					containers: [
						container('Dup', { definitionRef: '/P/D', parameters: [parameter('V', '2')] }),
						container('Dup', { definitionRef: '/P/D', parameters: [parameter('V', '3')] }),
					],
				})
			)
		);
		const { document } = diffOf(left, right);
		assert.strictEqual(document.summary.changed, 1);
		assert.strictEqual(document.summary.added, 0);
		assert.strictEqual(document.summary.removed, 0);
		const changed = document.rows.filter((row) => row.status === 'changed');
		assert.strictEqual(changed.length, 1);
		assert.deepStrictEqual(changed[0].changes, [{ field: 'value', left: '1', right: '3' }]);
	});

	test('AC5/R6: a changed condition on a reordered duplicate stays one changed row', () => {
		const left = arxml(
			module(
				'M1',
				container('C1', {
					containers: [
						container('Dup', { definitionRef: '/P/D', condition: '(A == 1)' }),
						container('Dup', { definitionRef: '/P/D', condition: '(A == 2)' }),
					],
				})
			)
		);
		const right = arxml(
			module(
				'M1',
				container('C1', {
					containers: [
						container('Dup', { definitionRef: '/P/D', condition: '(A == 2)' }),
						container('Dup', { definitionRef: '/P/D', condition: '(A == 3)' }),
					],
				})
			)
		);
		const { document } = diffOf(left, right);
		assert.strictEqual(document.summary.changed, 1);
		assert.strictEqual(document.summary.added, 0);
		assert.strictEqual(document.summary.removed, 0);
		const changed = document.rows.filter((row) => row.status === 'changed');
		assert.deepStrictEqual(changed[0].changes.map((change) => [change.field, change.left, change.right]), [
			['condition', '[(A == 1)]', '[(A == 3)]'],
		]);
	});

	test('R8/R9: a shifted duplicate pairing never reuses a page key', () => {
		// The left row a#0 pairs with the right a#1 by content; the right-only b#0
		// still carries the `#0` ordinal, so its raw id equals the paired left id.
		const left = arxml(module('M1', container('C1', { parameters: [parameter('Dup', 'a', true)] })));
		const right = arxml(
			module(
				'M1',
				container('C1', { parameters: [parameter('Dup', 'b', true), parameter('Dup', 'a', true)] })
			)
		);
		const { document } = diffOf(left, right);
		assert.strictEqual(document.summary.changed, 0);
		assert.strictEqual(document.summary.removed, 0);
		assert.strictEqual(document.summary.added, 1);
		const keys = document.rows.map((row) => row.key);
		assert.strictEqual(new Set(keys).size, keys.length, 'every merged row has its own key');
		assert.ok(keys.some((key) => key.startsWith('right:')), 'the added row is namespaced');
	});

	test('R8/R9: a shifted duplicate container pairing keeps the added subtree keys distinct', () => {
		const left = arxml(
			module('M1', container('C1', { containers: [container('Dup', { definitionRef: '/P/X', parameters: [parameter('V', '1')] })] }))
		);
		const right = arxml(
			module(
				'M1',
				container('C1', {
					containers: [
						container('Dup', { definitionRef: '/P/Y', parameters: [parameter('V', '2')] }),
						container('Dup', { definitionRef: '/P/X', parameters: [parameter('V', '1')] }),
					],
				})
			)
		);
		const { document } = diffOf(left, right);
		assert.strictEqual(document.summary.changed, 0);
		assert.strictEqual(document.summary.removed, 0, 'the paired container has no false removals');
		assert.strictEqual(document.summary.added, 2, 'only the added container and its parameter');
		const keys = document.rows.map((row) => row.key);
		assert.strictEqual(new Set(keys).size, keys.length, 'the added subtree does not reuse a paired key');
		for (const row of document.rows) {
			if (row.parentKey !== null) {
				assert.ok(keys.includes(row.parentKey), `${row.key} has a parent in the merged list`);
			}
		}
	});

	test('AC6: moving a container under another parent is one removal and one addition', () => {
		const moved = container('Moved', { parameters: [parameter('V', '7')] });
		const left = arxml(module('M1', container('A', { containers: [moved] }) + container('B', {})));
		const right = arxml(module('M1', container('A', {}) + container('B', { containers: [moved] })));
		const { document } = diffOf(left, right);
		const removed = document.rows.find(
			(row) => row.status === 'removed' && row.left?.label === 'Moved'
		);
		const added = document.rows.find((row) => row.status === 'added' && row.right?.label === 'Moved');
		assert.ok(removed, 'the old parent path is removed');
		assert.ok(added, 'the new parent path is added');
		assert.ok(removed!.key.includes('/A/Moved'), removed!.key);
		assert.ok(added!.key.includes('/B/Moved'), added!.key);
		assert.strictEqual(document.summary.removed, 2, 'Moved plus its parameter');
		assert.strictEqual(document.summary.added, 2);
	});

	test('R9: a right-only child lands after the nearest preceding matched sibling, or before the first', () => {
		const left = arxml(module('M1', container('B', {}) + container('C', {})));
		const right = arxml(
			module('M1', container('A', {}) + container('B', {}) + container('C', {}) + container('D', {}))
		);
		const { document } = diffOf(left, right);
		const children = document.rows.filter((row) => row.level === 2).map((row) => (row.left ?? row.right)!.label);
		assert.deepStrictEqual(children, ['A', 'B', 'C', 'D'], 'left order is kept and additions sit by their right context');
		assert.strictEqual(document.rows.find((row) => (row.left ?? row.right)!.label === 'A')!.status, 'added');
		assert.strictEqual(document.rows.find((row) => (row.left ?? row.right)!.label === 'D')!.status, 'added');
	});

	test('design §2.2: level, parent and subtreeSize are recomputed over the merged tree', () => {
		const left = arxml(module('M1', container('A', { parameters: [parameter('P', '1')] }) + container('B', {})));
		const right = arxml(
			module(
				'M1',
				container('A', { parameters: [parameter('P', '2')] }) +
					container('B', {}) +
					container('Added', { parameters: [parameter('Q', '1')] })
			)
		);
		const { document } = diffOf(left, right);
		for (let i = 0; i < document.rows.length; i++) {
			const row = document.rows[i];
			if (row.parentKey === null) {
				assert.strictEqual(row.level, 1);
			} else {
				const parent = document.rows.find((candidate) => candidate.key === row.parentKey);
				assert.ok(parent, `${row.key} has a parent row`);
				assert.strictEqual(row.level, parent!.level + 1);
				const parentIndex = document.rows.indexOf(parent!);
				assert.ok(parentIndex < i, 'parents precede children');
			}
			const end = i + 1 + row.subtreeSize;
			for (let at = i + 1; at < end; at++) {
				assert.ok(document.rows[at].level > row.level, 'subtreeSize covers the descendants');
			}
		}
		assert.ok(document.rows.some((row) => row.hasChildren && row.subtreeSize > 0));
		const roots = document.rows.filter((row) => row.parentKey === null);
		const moduleKey = roots[0].key;
		const children = document.rows.filter((row) => row.parentKey === moduleKey);
		assert.deepStrictEqual(
			children.map((row) => row.posinset),
			[1, 2, 3],
			'sibling positions are 1-based in merged order'
		);
		assert.ok(
			children.every((row) => row.setsize === 3),
			'every sibling reports the merged sibling count'
		);
	});

	test('the document carries the same pane labels the compare title uses', () => {
		const left = side(fixtureText('diff/left.arxml'));
		const right = side(fixtureText('diff/right.arxml'));
		const document = buildDiffDocument(
			{ name: 'same.arxml', path: '/w/a/same.arxml' },
			{ name: 'same.arxml', path: '/w/b/same.arxml' },
			left.rows,
			right.rows
		);
		assert.deepStrictEqual(document.labels, ['a/same.arxml', 'b/same.arxml']);
	});

	test('R10: titles disambiguate same-named files by the shortest path suffix', () => {
		assert.strictEqual(
			compareTitle({ name: 'left.arxml', path: '/w/left.arxml' }, { name: 'right.arxml', path: '/w/right.arxml' }),
			'left.arxml ↔ right.arxml'
		);
		assert.strictEqual(
			compareTitle({ name: 'same.arxml', path: '/w/a/same.arxml' }, { name: 'same.arxml', path: '/w/b/same.arxml' }),
			'a/same.arxml ↔ b/same.arxml',
			'same basename: the shortest distinguishing suffix is used'
		);
		assert.strictEqual(
			compareTitle({ name: 'same.arxml', path: '/w/same.arxml' }, { name: 'same.arxml', path: '/w/same.arxml' }),
			'same.arxml ↔ same.arxml',
			'a file compared with itself keeps the basename, not the full path twice'
		);
		assert.deepStrictEqual(
			disambiguatedLabels({ name: 'same.arxml', path: '/a/x/same.arxml' }, { name: 'same.arxml', path: '/b/y/same.arxml' }),
			['x/same.arxml', 'y/same.arxml']
		);
		assert.deepStrictEqual(
			disambiguatedLabels({ name: 'same.arxml', path: '/a/x/same.arxml' }, { name: 'same.arxml', path: '/b/x/same.arxml' }),
			['a/x/same.arxml', 'b/x/same.arxml']
		);
	});

	test('design §3.3: Show all shows every row and Show diff only keeps changes and ancestors', () => {
		const left = arxml(
			module(
				'M1',
				container('C1', { parameters: [parameter('Keep', '1'), parameter('Changed', '10')] }) +
					container('Gone', { parameters: [parameter('GoneChild', '2')] })
			)
		);
		const right = arxml(
			module('M1', container('C1', { parameters: [parameter('Keep', '1'), parameter('Changed', '11')] }))
		);
		const { document } = diffOf(left, right);
		const rows = document.rows;

		const all = diffVisibility(rows, false);
		assert.strictEqual(all.length, rows.length);
		assert.ok(all.every(Boolean), 'every row is visible in Show all');

		const changesOnly = diffVisibility(rows, true);
		for (let i = 0; i < rows.length; i++) {
			if (rows[i].status !== 'unchanged') {
				assert.ok(changesOnly[i], `change ${rows[i].key} is visible`);
			}
			if (rows[i].status === 'unchanged' && !rows[i].hasChildren) {
				assert.strictEqual(changesOnly[i], false, `unchanged leaf ${rows[i].key} is hidden`);
			}
		}
		assert.ok(changesOnly[0], 'the module ancestor stays visible');
		assert.ok(changesOnly[1], 'the container ancestor stays visible');
		const keepIndex = rows.findIndex((row) => (row.left ?? row.right)?.label === 'Keep');
		const goneIndex = rows.findIndex((row) => (row.left ?? row.right)?.label === 'Gone');
		assert.strictEqual(changesOnly[keepIndex], false, 'an unchanged row is hidden');
		assert.ok(changesOnly[goneIndex], 'a removed container is visible');
	});

	test('design §3.3: flatten skips collapsed subtrees in every view', () => {
		const left = arxml(
			module(
				'M1',
				container('C1', { parameters: [parameter('Keep', '1')] }) +
					container('C2', { parameters: [parameter('Deep', '2')] })
			)
		);
		const right = arxml(
			module(
				'M1',
				container('C1', { parameters: [parameter('Keep', '9')] }) +
					container('C2', { parameters: [parameter('Deep', '2')] })
			)
		);
		const { document } = diffOf(left, right);
		const rows = document.rows;
		const moduleRow = rows.find((row) => row.level === 1)!;
		const collapsed = new Set([moduleRow.key]);

		const noView = flattenDiffRows(rows, { collapsed });
		assert.deepStrictEqual(noView.map((flat) => flat.rowIndex), [0], 'a collapsed root hides its subtree');

		const visibility = diffVisibility(rows, true);
		const diffOnly = flattenDiffRows(rows, {
			collapsed,
			visible: visibility,
		});
		assert.deepStrictEqual(diffOnly.map((flat) => flat.rowIndex), [0], 'Show diff only respects the collapse');
		assert.deepStrictEqual(Array.from(collapsed), [moduleRow.key], 'the collapsed set was not written');

		const reopened = flattenDiffRows(rows, { visible: visibility });
		const shown = reopened.map((flat) => rows[flat.rowIndex]);
		assert.ok(shown.some((row) => (row.left ?? row.right)?.label === 'Keep'), 'expanding reaches the changed row');
	});

	test('design §3.3: next/previous change wraps and respects visibility', () => {
		const left = arxml(
			module(
				'M1',
				container('C1', { parameters: [parameter('A', '1'), parameter('B', '2')] }) +
					container('C2', { parameters: [parameter('C', '3')] })
			)
		);
		const right = arxml(
			module(
				'M1',
				container('C1', { parameters: [parameter('A', '9'), parameter('B', '2')] }) +
					container('C2', { parameters: [parameter('C', '9')] })
			)
		);
		const { document } = diffOf(left, right);
		const rows = document.rows;
		const changeIndexes = rows.map((row, index) => (row.status === 'unchanged' ? -1 : index)).filter((index) => index >= 0);
		assert.strictEqual(changeIndexes.length, 2);

		assert.strictEqual(nextChangeIndex(rows, undefined, -1, 1), changeIndexes[0], 'forward starts at the first change');
		assert.strictEqual(nextChangeIndex(rows, undefined, changeIndexes[0], 1), changeIndexes[1]);
		assert.strictEqual(nextChangeIndex(rows, undefined, changeIndexes[1], 1), changeIndexes[0], 'forward wraps');
		assert.strictEqual(nextChangeIndex(rows, undefined, changeIndexes[0], -1), changeIndexes[1], 'backward wraps');
		assert.strictEqual(nextChangeIndex(rows, undefined, -1, -1), changeIndexes[1], 'backward starts at the last change');

		const visible = rows.map(() => true);
		visible[changeIndexes[1]] = false;
		assert.strictEqual(nextChangeIndex(rows, visible, changeIndexes[0], 1), changeIndexes[0], 'hidden changes are skipped');
		assert.strictEqual(nextChangeIndex(rows, rows.map(() => false), -1, 1), -1, 'no visible change yields -1');
		assert.strictEqual(nextChangeIndex([], undefined, -1, 1), -1);
	});

	test('the committed left/right fixtures cover changed, added, removed, moved and duplicate rows', () => {
		const { document } = diffOf(fixtureText('diff/left.arxml'), fixtureText('diff/right.arxml'));
		assert.deepStrictEqual(document.summary, { changed: 2, added: 6, removed: 6, unchanged: 10 });

		assert.deepStrictEqual(
			document.rows.filter((row) => row.status === 'changed').map((row) => (row.left ?? row.right)!.label).sort(),
			['Changed', 'TargetRef']
		);
		const added = document.rows.filter((row) => row.status === 'added').map((row) => (row.right ?? row.left)!.label).sort();
		assert.deepStrictEqual(added, ['AddedParam', 'ContAdded', 'ContAddedNested', 'ContMoved', 'MovedValue', 'NestedText']);
		const removed = document.rows.filter((row) => row.status === 'removed').map((row) => (row.left ?? row.right)!.label).sort();
		assert.deepStrictEqual(removed, ['ContMoved', 'ContRemoved', 'ContRemovedNested', 'MovedValue', 'NestedValue', 'RemovedChild']);

		// The duplicate-name swap must not be a change.
		const duplicates = document.rows.filter((row) => (row.left ?? row.right)!.label === 'Dup');
		assert.strictEqual(duplicates.length, 2);
		assert.ok(duplicates.every((row) => row.status === 'unchanged'));
		// Reordered modules stay paired.
		const moduleByShortName = (shortName: string): DiffRow => {
			const row = document.rows.find((candidate) => candidate.kind === 'module' && candidate.left?.shortName === shortName);
			assert.ok(row, `a module row for ${shortName} exists`);
			return row!;
		};
		assert.strictEqual(moduleByShortName('ModAlpha').status, 'unchanged');
		assert.strictEqual(moduleByShortName('ModBeta').status, 'unchanged');
	});
});
