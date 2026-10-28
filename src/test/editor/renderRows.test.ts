/**
 * Task design §2 — the host row model is the single source of the display
 * order, meta/value/target fields and search haystacks.
 *
 * The assertions are on values, not markup: a row must not carry HTML, the
 * display order must match the existing order/meta rules (including the
 * `sort all` exceptions), and `parentId`/`subtreeSize`/posinset must be
 * internally consistent for the page's collapse and ancestor passes.
 */
import * as assert from 'assert';

import { ContainerNode, EcucDocumentModel, ModuleNode, ParameterNode, ReferenceNode } from '../../core/ecuc/model';
import { scanEcucValues } from '../../core/ecuc/scanner';
import { buildRows } from '../../editor/renderRows';
import { fixtureText } from '../core/modelTestUtils';

const FIXTURE = 'editor/render.arxml';

function fixtureRows(): ReturnType<typeof buildRows> {
	return buildRows(scanEcucValues(fixtureText(FIXTURE)));
}

suite('editor row model (design §2)', () => {
	test('design §2: rows are in display order with levels and contiguous subtrees', () => {
		const doc = fixtureRows();
		assert.deepStrictEqual(
			doc.rows.map((row) => `${row.label}@${row.level}`),
			[
				'PkgA.PkgB.ModDefs.ModX@1',
				'ContA@2',
				'Flag@3',
				'IniValue@3',
				'Title@3',
				'PeerIref@3',
				'PeerRef@3',
				'ContB@3',
				'Text@4',
			],
			'sorted DEFS, parameters before references before child containers'
		);
		assert.deepStrictEqual(
			doc.rows.map((row) => row.subtreeSize),
			[8, 7, 0, 0, 0, 0, 0, 1, 0],
			'descendants are contiguous after their parent'
		);
		assert.deepStrictEqual(
			doc.rows.map((row) => row.hasChildren),
			[true, true, false, false, false, false, false, true, false]
		);

		assert.strictEqual(doc.rows[0].parentId, null, 'a module has no parent');
		for (const row of doc.rows.slice(1)) {
			assert.ok(row.parentId !== null, `${row.label} has a parent id`);
		}
		const byId = new Map(doc.rows.map((row) => [row.id, row]));
		for (const row of doc.rows) {
			if (row.parentId === null) {
				continue;
			}
			const parent = byId.get(row.parentId);
			assert.ok(parent, `${row.label}'s parent exists in the row set`);
			assert.strictEqual(row.level, parent.level + 1, `${row.label}'s level follows its parent`);
		}
	});

	test('design §2: posinset/setsize use the same contiguous group as the renderer', () => {
		const doc = fixtureRows();
		const byLabel = (label: string) => {
			const row = doc.rows.find((candidate) => candidate.label === label);
			assert.ok(row, label);
			return row;
		};
		assert.deepStrictEqual(
			{ pos: byLabel('PkgA.PkgB.ModDefs.ModX').posinset, size: byLabel('PkgA.PkgB.ModDefs.ModX').setsize },
			{ pos: 1, size: 1 }
		);
		const contA = byLabel('ContA');
		assert.deepStrictEqual({ pos: contA.posinset, size: contA.setsize }, { pos: 1, size: 1 });
		assert.deepStrictEqual(
			doc.rows.filter((row) => row.parentId === contA.id).map((row) => [row.label, row.posinset, row.setsize]),
			[
				['Flag', 1, 6],
				['IniValue', 2, 6],
				['Title', 3, 6],
				['PeerIref', 4, 6],
				['PeerRef', 5, 6],
				['ContB', 6, 6],
			],
			'parameters, then references, then child containers'
		);
		assert.deepStrictEqual(
			{ pos: byLabel('ContB').posinset, size: byLabel('ContB').setsize },
			{ pos: 6, size: 6 },
			'the nested container is the sixth child of ContA'
		);
	});

	test('design §2: labels, values, targets, context and meta parts are values', () => {
		const doc = fixtureRows();
		const byLabel = (label: string) => {
			const row = doc.rows.find((candidate) => candidate.label === label);
			assert.ok(row, label);
			return row;
		};

		const moduleRow = byLabel('PkgA.PkgB.ModDefs.ModX');
		assert.strictEqual(moduleRow.shortName, 'ModX');
		assert.strictEqual(moduleRow.title, '/PkgA/PkgB/ModDefs/ModX');
		assert.deepStrictEqual(moduleRow.meta.map((part) => `${part.cls}:${part.text}`), [
			'short:"ModX"',
			'variant:(VariantPreCompile)',
			'condition:[(A == B)]',
			'condition:<Crit1 == 1 && Crit2 == 2>',
			'annotation:[Note] module note',
		]);

		const contA = byLabel('ContA');
		assert.strictEqual(contA.definitionRef, '/PkgA/PkgB/ModDefs/ModX/ContA');
		assert.deepStrictEqual(contA.meta.map((part) => `${part.cls}:${part.text}`), [
			'short:"ContA"',
			'annotation:container note',
		]);

		const ini = byLabel('IniValue');
		assert.strictEqual(ini.value, '63');
		assert.strictEqual(ini.valueKind, 'numeric');
		assert.strictEqual(ini.shownValue, '63');
		assert.deepStrictEqual(ini.meta.map((part) => `${part.cls}:${part.text}`), ['hex:(= 0x3F)']);

		const title = byLabel('Title');
		assert.strictEqual(title.valueKind, 'textual');
		assert.strictEqual(title.shownValue, '"hello"', 'a textual value is quoted');

		const flag = byLabel('Flag');
		assert.strictEqual(flag.valueKind, 'boolean');
		assert.strictEqual(flag.shownValue, 'true', 'a boolean value is left bare');

		const peer = byLabel('PeerIref');
		assert.strictEqual(peer.value, 'PkgA.PkgB.ModX.ContA.ContB', 'the dotted target is displayed');
		assert.strictEqual(peer.shownValue, 'PkgA.PkgB.ModX.ContA.ContB');
		assert.strictEqual(peer.target, '/PkgA/PkgB/ModX/ContA/ContB', 'the raw target is kept for follow');
		assert.strictEqual(peer.followable, true, 'a same-file target is followable');
		assert.deepStrictEqual(peer.contextPaths, ['PkgA.PkgB.ModX.ContA']);
		assert.deepStrictEqual(peer.meta.map((part) => `${part.cls}:${part.text}`), [
			'context:context PkgA.PkgB.ModX.ContA',
		]);
	});

	test('design §2: reference followability is same-file only', () => {
		const rows = buildRows(scanEcucValues(fixtureText('editor/navigation.arxml'))).rows;
		const byLabel = (label: string) => rows.find((row) => row.label === label);
		assert.strictEqual(byLabel('Good')?.followable, true);
		assert.strictEqual(byLabel('Missing')?.followable, false);
		assert.strictEqual(byLabel('Ambiguous')?.followable, false);
	});

	test('design §2: haystacks are lower-cased label + short name + value', () => {
		const doc = fixtureRows();
		const byLabel = (label: string) => doc.rows.find((row) => row.label === label)?.haystack;
		assert.strictEqual(byLabel('PkgA.PkgB.ModDefs.ModX'), 'pkga.pkgb.moddefs.modx modx');
		assert.strictEqual(byLabel('ContA'), 'conta conta');
		assert.strictEqual(byLabel('IniValue'), 'inivalue 63');
		assert.strictEqual(byLabel('Title'), 'title hello');
		assert.strictEqual(byLabel('PeerRef'), 'peerref pkga.pkgb.modx.conta.contb');
	});

	test('design §2: rows carry no display-only source position or digit width', () => {
		const doc = fixtureRows();
		for (const row of doc.rows) {
			assert.ok(!('sourceLine' in row), 'no source line');
			assert.ok(!('line' in row), 'no 0-based line');
			assert.ok(!('column' in row), 'no column');
			assert.ok(!('endLine' in row), 'no end line');
			assert.ok(!('endColumn' in row), 'no end column');
		}
		assert.ok(!('digits' in doc), 'no line-number gutter width');
	});

	test('design §2: sort all uses the exception list, declaration keeps the authored order', () => {
		const model = scanEcucValues(fixtureText('exceptions.arxml'));
		assert.deepStrictEqual(
			buildRows(model).rows.map((row) => row.label),
			['D.M', 'C', 'Alpha', 'Beta', 'DcmDspDidRef', 'DcmDspDidRef', 'DemDidClassRef', 'Zeta'],
			'exceptions keep declaration order among themselves'
		);
		assert.deepStrictEqual(
			buildRows(model, { sort: 'declaration' }).rows.map((row) => row.label),
			['D.M', 'C', 'Zeta', 'DcmDspDidRef', 'Alpha', 'DemDidClassRef', 'DcmDspDidRef', 'Beta']
		);
	});

	test('design §2: ids keep the declaration-order ordinal when the display order changes', () => {
		const model = scanEcucValues(fixtureText('editor/sibling-sort-order.arxml'));
		const sorted = buildRows(model).rows;
		const declared = buildRows(model, { sort: 'declaration' }).rows;
		const zetaSorted = sorted.find((row) => row.label === 'Zeta');
		const zetaDeclared = declared.find((row) => row.label === 'Zeta');
		assert.ok(zetaSorted && zetaDeclared);
		assert.strictEqual(zetaSorted.id, zetaDeclared.id, 'the id is stable across a sort re-scan');
		assert.notStrictEqual(
			sorted.find((row) => row.label === 'Alpha')?.id,
			zetaSorted.id,
			'two same-named siblings get distinct ids'
		);
	});

	test('design §2: deep nesting keeps the contiguous subtree invariant', () => {
		const rows = buildRows(scanEcucValues(fixtureText('deep.arxml'))).rows;
		assert.deepStrictEqual(
			rows.map((row) => row.level),
			[1, 2, 3, 4, 5, 6, 7]
		);
		assert.deepStrictEqual(
			rows.map((row) => row.subtreeSize),
			[6, 5, 4, 3, 2, 1, 0]
		);
	});

	test('design §2: a large synthetic model builds in DFS order without HTML', () => {
		const modules: ModuleNode[] = [];
		const CONTAINERS_PER_MODULE = 10;
		const PARAMETERS_PER_CONTAINER = 5;
		const NESTED_PER_CONTAINER = 2;
		const PARAMETERS_PER_NESTED = 3;
		for (let m = 0; m < 80; m++) {
			const containers: ContainerNode[] = [];
			for (let c = 0; c < CONTAINERS_PER_MODULE; c++) {
				const parameters: ParameterNode[] = [];
				for (let p = 0; p < PARAMETERS_PER_CONTAINER; p++) {
					parameters.push(syntheticParameter(`/D/M${m}/C${c}/P${p}`, String(p)));
				}
				const nested: ContainerNode[] = [];
				for (let n = 0; n < NESTED_PER_CONTAINER; n++) {
					const nestedParameters: ParameterNode[] = [];
					for (let p = 0; p < PARAMETERS_PER_NESTED; p++) {
						nestedParameters.push(syntheticParameter(`/D/M${m}/C${c}/N${n}/P${p}`, String(p)));
					}
					nested.push(syntheticContainer(`N${n}`, `/D/M${m}/C${c}/N${n}`, nestedParameters));
				}
				containers.push(syntheticContainer(`C${c}`, `/D/M${m}/C${c}`, parameters, nested));
			}
			modules.push(syntheticModule(`M${m}`, `/D/M${m}`, containers));
		}
		const model: EcucDocumentModel = { packages: [], modules, pathIndex: new Map() };
		const doc = buildRows(model);
		const expected = modules.length * (1 + CONTAINERS_PER_MODULE * (1 + PARAMETERS_PER_CONTAINER + NESTED_PER_CONTAINER * (1 + PARAMETERS_PER_NESTED)));
		assert.strictEqual(doc.rows.length, expected, 'every module/container/parameter is a row');
		assert.ok(doc.rows.length > 10000, 'the synthetic set is huge-file sized');

		const lastIndex = doc.rows.length - 1;
		for (let i = 0; i <= lastIndex; i++) {
			const row = doc.rows[i];
			const end = i + row.subtreeSize;
			assert.ok(end <= lastIndex, `${row.label}'s subtree fits in the row set`);
			assert.strictEqual(row.hasChildren, row.subtreeSize > 0, `${row.label}'s hasChildren agrees with subtreeSize`);
			assert.strictEqual(row.posinset >= 1 && row.posinset <= row.setsize, true, row.label);
			for (let child = i + 1; child <= end; child++) {
				assert.ok(doc.rows[child].level > row.level, `${row.label}'s subtree only contains deeper rows`);
			}
			if (end < lastIndex) {
				assert.ok(doc.rows[end + 1].level <= row.level, `${row.label}'s subtree is contiguous`);
			}
		}
		assert.ok(!JSON.stringify(doc).includes('<span'), 'the row data carries no markup');
	});
});

function syntheticParameter(definitionRef: string, value: string): ParameterNode {
	return {
		kind: 'parameter',
		numeric: true,
		definitionRef,
		name: definitionRef.slice(definitionRef.lastIndexOf('/') + 1),
		displayValue: value,
		range: { start: 0, end: 0 },
	};
}

function syntheticContainer(
	shortName: string,
	definitionRef: string,
	parameters: ParameterNode[],
	containers: ContainerNode[] = []
): ContainerNode {
	return {
		kind: 'container',
		definitionRef,
		shortName,
		range: { start: 0, end: 0 },
		containerPath: [],
		parameters,
		references: [] as ReferenceNode[],
		containers,
	};
}

function syntheticModule(shortName: string, definitionRef: string, containers: ContainerNode[]): ModuleNode {
	return {
		kind: 'module',
		definitionRef,
		shortName,
		range: { start: 0, end: 0 },
		containers,
	};
}
